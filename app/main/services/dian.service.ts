import { eq } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { AppError, ErrorCode } from '../utils/errors';
import { nowISO } from '../utils/date';
import type { SaleRecord } from '../../renderer/src/shared/types/sales.types';

export interface DianConfig {
  apiKey: string;
  accountId: string;
  baseUrl: string;
  dianResolution: string;
  dianPrefix: string;
}

export interface DianInvoiceResponse {
  cufe: string;
  status: 'PENDING' | 'VALIDATED' | 'REJECTED';
  pdfUrl?: string;
  xmlUrl?: string;
  dianResponse?: string;
}

export interface FactusInvoiceItem {
  code_reference: string;
  name: string;
  quantity: number;
  price: number;
  tax_rate: string;
  tax_category: string;
  discount: number;
  type_unit: number;
}

export interface FactusInvoiceRequest {
  reference: string;
  observation?: string;
  payment_method: string;
  payment_forms: string;
  duration_measure?: string;
  customer: {
    identification: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    merchant_registration?: string;
  };
  items: FactusInvoiceItem[];
}

export class DianService {
  constructor() {}

  private async loadConfig(accountId: number): Promise<DianConfig> {
    const db = getDatabase();
    const [account] = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);

    if (!account) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Cuenta no encontrada');
    }

    return {
      apiKey: process.env.FACTUS_API_KEY || '',
      accountId: process.env.FACTUS_ACCOUNT_ID || '',
      baseUrl: process.env.FACTUS_BASE_URL || 'https://api.factus.com.co',
      dianResolution: account.dianResolution || '',
      dianPrefix: account.dianPrefix || 'FV',
    };
  }

  async validateSubscription(accountId: number): Promise<boolean> {
    const db = getDatabase();
    const [account] = await db
      .select({ subscriptionStatus: schema.accounts.subscriptionStatus, trialEndsAt: schema.accounts.trialEndsAt })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1);

    if (!account) return false;

    if (account.subscriptionStatus === 'ACTIVE') return true;
    if (account.subscriptionStatus === 'TRIAL' && account.trialEndsAt) {
      return new Date(account.trialEndsAt) > new Date();
    }
    return false;
  }

  async generateInvoice(sale: SaleRecord, accountId: number): Promise<DianInvoiceResponse> {
    const config = await this.loadConfig(accountId);

    const hasValidSubscription = await this.validateSubscription(accountId);
    if (!hasValidSubscription) {
      throw new AppError(ErrorCode.VALIDATION, 'Suscripción requerida para facturación electrónica');
    }

    const db = getDatabase();
    
    // Get customer info
    let customerDoc = '000000000000';
    let customerName = 'Consumidor Final';
    let customerPhone = '';
    let customerEmail = '';
    let customerAddress = '';

    if (sale.customerId) {
      const [customer] = await db
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.id, sale.customerId))
        .limit(1);
      
      if (customer) {
        customerDoc = customer.document || customerDoc;
        customerName = customer.name;
        customerPhone = customer.phone || '';
        customerEmail = customer.email || '';
        customerAddress = customer.address || '';
      }
    }

    // Build items for Factus API
    const items: FactusInvoiceItem[] = sale.items.map((item: { product: { code: string; name: string }; quantity: number; unitPrice: number; taxRate?: number; discount?: number }) => ({
      code_reference: item.product.code,
      name: item.product.name,
      quantity: item.quantity,
      price: item.unitPrice,
      tax_rate: String(item.taxRate || 0.19),
      tax_category: '01', // Gravado - IVA
      discount: item.discount ?? 0,
      type_unit: 94, // Unidad estándar
    }));

    const request: FactusInvoiceRequest = {
      reference: sale.saleNumber,
      observation: 'Venta POS - TuCajero',
      payment_method: this.mapPaymentMethod(sale.payments[0]?.method || 'efectivo'),
      payment_forms: sale.payments.some((p: { method: string }) => p.method === 'credito') ? '2' : '1',
      customer: {
        identification: customerDoc,
        name: customerName,
        phone: customerPhone,
        email: customerEmail,
        address: customerAddress,
      },
      items,
    };

    // Call Factus API (placeholder implementation)
    const response = await this.callFactusAPI(request, config);

    // Store invoice record
    const now = nowISO();
    await db.insert(schema.invoices).values({
      saleId: sale.id,
      accountId,
      cufe: response.cufe,
      dianStatus: response.status,
      dianResponse: response.dianResponse,
      pdfUrl: response.pdfUrl,
      xmlUrl: response.xmlUrl,
      sentAt: now,
      validatedAt: response.status === 'VALIDATED' ? now : undefined,
    }).run();

    return response;
  }

  private mapPaymentMethod(method: string): string {
    const map: Record<string, string> = {
      efectivo: '10',
      nequi: 'PM',
      daviplata: 'PM',
      tarjeta: '20',
      transferencia: 'PM',
      credito: 'PP',
    };
    return map[method] || '10';
  }

  private async callFactusAPI(_request: FactusInvoiceRequest, config: DianConfig): Promise<DianInvoiceResponse> {
    // This is a placeholder - actual implementation would call Factus API
    // Example endpoint: POST https://api.factus.com.co/v1/invoices
    
    if (!config.apiKey) {
      throw new AppError(ErrorCode.VALIDATION, 'API Key de Factus no configurada');
    }

    // Simulated response for placeholder
    const mockResponse: DianInvoiceResponse = {
      cufe: `CUFE-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      status: 'PENDING',
      pdfUrl: '',
      xmlUrl: '',
      dianResponse: 'Pendiente de validación DIAN',
    };

    return mockResponse;
  }

  async getInvoiceBySale(saleId: number): Promise<DianInvoiceResponse | null> {
    const db = getDatabase();
    const [invoice] = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.saleId, saleId))
      .limit(1);

    if (!invoice) return null;

    return {
      cufe: invoice.cufe,
      status: invoice.dianStatus as 'PENDING' | 'VALIDATED' | 'REJECTED',
      pdfUrl: invoice.pdfUrl || undefined,
      xmlUrl: invoice.xmlUrl || undefined,
      dianResponse: invoice.dianResponse || undefined,
    };
  }

  async sendCreditNote(_saleId: number, _reason: string, _accountId: number): Promise<void> {
    // Implementation for credit notes via DIAN
    // Would call Factus API for credit note generation
  }

  async validateNIT(_nit: string): Promise<{ isValid: boolean; name?: string; address?: string } | null> {
    // Would call DIAN or Factus API to validate NIT
    // Placeholder implementation
    return { isValid: true, name: '', address: '' };
  }
}
