import { eq, like, sql } from 'drizzle-orm';

import { getDatabase, schema } from '../db';
import { AppError, ErrorCode } from './errors';

/**
 * Siguiente número consecutivo de un documento (venta o cotización) con prefijo,
 * por ejemplo `V-2026-0001`.
 *
 * El número se toma como entero (`MAX(CAST(...))`): ordenar el texto fallaba al
 * pasar de la venta 9.999 del año, porque «9999» es mayor que «10000» como texto,
 * así que siempre se proponía un número ya existente y no se podía vender más.
 */
export async function nextDocumentNumber(prefix: string, label: string): Promise<string> {
  const db = getDatabase();

  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await db
      .select({ last: sql<number | null>`max(cast(substr(${schema.sales.saleNumber}, ${prefix.length + 1}) as integer))` })
      .from(schema.sales)
      .where(like(schema.sales.saleNumber, `${prefix}%`));

    const next = Number(row?.last ?? 0) + 1 + attempt;
    const candidate = `${prefix}${String(next).padStart(4, '0')}`;

    const [existing] = await db
      .select({ id: schema.sales.id })
      .from(schema.sales)
      .where(eq(schema.sales.saleNumber, candidate))
      .limit(1);

    if (!existing) return candidate;
  }

  throw new AppError(ErrorCode.VALIDATION, `No se pudo generar el número de ${label}. Intente nuevamente.`);
}
