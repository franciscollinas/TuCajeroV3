import { eq, and } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { nowISO } from '../utils/date';
import { AppError, ErrorCode } from '../utils/errors';

export class BranchService {
  async list(accountId?: number | null): Promise<typeof schema.branches.$inferSelect[]> {
    const db = getDatabase();
    return db
      .select()
      .from(schema.branches)
      .where(and(eq(schema.branches.isActive, true), ...(accountId ? [eq(schema.branches.accountId, accountId)] : [])))
      .orderBy(schema.branches.name);
  }

  async listAll(accountId?: number | null): Promise<typeof schema.branches.$inferSelect[]> {
    const db = getDatabase();
    return db
      .select()
      .from(schema.branches)
      .where(accountId ? eq(schema.branches.accountId, accountId) : undefined)
      .orderBy(schema.branches.name);
  }

  async getById(id: number, accountId?: number | null) {
    const db = getDatabase();
    const [branch] = await db
      .select()
      .from(schema.branches)
      .where(and(eq(schema.branches.id, id), ...(accountId ? [eq(schema.branches.accountId, accountId)] : [])))
      .limit(1);
    return branch ?? null;
  }

  async create(input: {
    name: string;
    code: string;
    address?: string | null;
    phone?: string | null;
    accountId: number;
  }) {
    const db = getDatabase();
    const [existing] = await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.code, input.code))
      .limit(1);
    if (existing) {
      throw new AppError(ErrorCode.VALIDATION, `Ya existe una sucursal con el código '${input.code}'`);
    }

    const now = nowISO();
    const [branch] = await db
      .insert(schema.branches)
      .values({
        accountId: input.accountId,
        name: input.name,
        code: input.code,
        address: input.address ?? null,
        phone: input.phone ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return branch;
  }

  async update(id: number, data: {
    name?: string;
    code?: string;
    address?: string | null;
    phone?: string | null;
    isActive?: boolean;
  }, accountId?: number | null) {
    const db = getDatabase();
    if (data.code) {
      const [existing] = await db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(and(eq(schema.branches.code, data.code), ...(accountId ? [eq(schema.branches.accountId, accountId)] : [])))
        .limit(1);
      if (existing && existing.id !== id) {
        throw new AppError(ErrorCode.VALIDATION, `Ya existe otra sucursal con el código '${data.code}'`);
      }
    }

    const [branch] = await db
      .update(schema.branches)
      .set({ ...data, updatedAt: nowISO() })
      .where(and(eq(schema.branches.id, id), ...(accountId ? [eq(schema.branches.accountId, accountId)] : [])))
      .returning();
    return branch;
  }

  async delete(id: number, accountId?: number | null): Promise<void> {
    const db = getDatabase();
    await db
      .update(schema.branches)
      .set({ isActive: false, updatedAt: nowISO() })
      .where(and(eq(schema.branches.id, id), ...(accountId ? [eq(schema.branches.accountId, accountId)] : [])));
  }

  async getDefaultBranchId(accountId?: number | null): Promise<number> {
    const db = getDatabase();
    const [first] = await db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(and(eq(schema.branches.isActive, true), ...(accountId ? [eq(schema.branches.accountId, accountId)] : [])))
      .orderBy(schema.branches.id)
      .limit(1);
    return first?.id ?? 0;
  }
}
