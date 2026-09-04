import { z } from 'zod';

const moneyAmount = z.number().finite().min(0).max(999_999_999);
const nonNegativeQty = z.number().finite().min(0).max(9_999_999);
const taxRateFraction = z.number().finite().min(0).max(1);

export const productCreateInputSchema = z.object({
  code: z.string(),
  barcode: z.string().optional().nullable(),
  name: z.string(),
  description: z.string().optional().nullable(),
  categoryId: z.number().optional(),
  categoryName: z.string().optional(),
  price: moneyAmount,
  cost: moneyAmount,
  stock: nonNegativeQty,
  minStock: nonNegativeQty.optional(),
  criticalStock: nonNegativeQty.optional(),
  taxRate: taxRateFraction.optional(),
  suggestedPurchaseQty: nonNegativeQty.optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  unitType: z.string().optional(),
  conversionFactor: z.number().finite().min(0).max(9_999_999).optional(),
  userId: z.number(),
});

export const productUpdateInputSchema = z.object({
  code: z.string().optional(),
  barcode: z.string().optional().nullable(),
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  categoryId: z.number().optional(),
  categoryName: z.string().optional(),
  price: moneyAmount.optional(),
  cost: moneyAmount.optional(),
  stock: nonNegativeQty.optional(),
  minStock: nonNegativeQty.optional(),
  criticalStock: nonNegativeQty.optional(),
  taxRate: taxRateFraction.optional(),
  suggestedPurchaseQty: nonNegativeQty.optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  unitType: z.string().optional(),
  conversionFactor: z.number().finite().min(0).max(9_999_999).optional(),
  userId: z.number().optional(),
});
