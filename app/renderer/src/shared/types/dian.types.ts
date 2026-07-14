export type SubscriptionPlan = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'CANCELLED' | 'EXPIRED';

export interface Account {
  id: number;
  name: string;
  nit: string;
  email: string;
  phone: string | null;
  address: string | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionPlan: SubscriptionPlan;
  trialEndsAt: string | null;
  dianResolution: string | null;
  dianPrefix: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: number;
  accountId: number;
  stripeSubscriptionId: string | null;
  plan: SubscriptionPlan;
  status: string;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
}

export interface ElectronicInvoice {
  id: number;
  saleId: number;
  accountId: number;
  cufe: string;
  dianStatus: 'PENDING' | 'VALIDATED' | 'REJECTED';
  dianResponse: string | null;
  pdfUrl: string | null;
  xmlUrl: string | null;
  sentAt: string | null;
  validatedAt: string | null;
}

export interface DianConfig {
  apiKey: string;
  accountId: string;
  baseUrl: string;
  dianResolution: string;
  dianPrefix: string;
}