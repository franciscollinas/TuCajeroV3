import { eq, and } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { nowISO } from '../utils/date';

export type BusinessConfig = {
  businessName: string;
  address: string;
  email: string;
  phone: string;
  nit: string;
  logo: string;
  ivaRate: number;
};

const DEFAULTS: BusinessConfig = {
  businessName: 'Mi Negocio',
  address: '',
  email: '',
  phone: '',
  nit: '',
  logo: '',
  ivaRate: 19,
};

const SENSITIVE_CONFIG_KEYS = ['license_data', 'printer_config'];

export class ConfigService {
  async getAll(accountId: number): Promise<Record<string, string>> {
    const db = getDatabase();
    const rows = await db.select().from(schema.configs).where(eq(schema.configs.accountId, accountId));
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }
    return map;
  }

  async getAllFiltered(accountId: number, isAdmin: boolean): Promise<Record<string, string>> {
    const all = await this.getAll(accountId);
    if (isAdmin) return all;
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(all)) {
      if (!SENSITIVE_CONFIG_KEYS.includes(key)) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  async get(key: string, accountId: number): Promise<string | null> {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(schema.configs)
      .where(and(eq(schema.configs.key, key), eq(schema.configs.accountId, accountId)))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async set(key: string, value: string, accountId: number): Promise<void> {
    const db = getDatabase();
    const existing = await db
      .select()
      .from(schema.configs)
      .where(and(eq(schema.configs.key, key), eq(schema.configs.accountId, accountId)))
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.configs)
        .set({ value, updatedAt: nowISO() })
        .where(and(eq(schema.configs.key, key), eq(schema.configs.accountId, accountId)));
    } else {
      await db
        .insert(schema.configs)
        .values({ accountId, key, value, updatedAt: nowISO() });
    }
  }

  async getBusinessConfig(accountId: number): Promise<BusinessConfig> {
    const all = await this.getAll(accountId);
    return {
      businessName: all.businessName || DEFAULTS.businessName,
      address: all.address || DEFAULTS.address,
      email: all.email || DEFAULTS.email,
      phone: all.phone || DEFAULTS.phone,
      nit: all.nit || DEFAULTS.nit,
      logo: all.logo || DEFAULTS.logo,
      ivaRate: Number(all.ivaRate) || DEFAULTS.ivaRate,
    };
  }

  async setBusinessConfig(config: BusinessConfig, accountId: number): Promise<BusinessConfig> {
    for (const [key, value] of Object.entries(config)) {
      await this.set(key, String(value), accountId);
    }
    return this.getBusinessConfig(accountId);
  }
}
