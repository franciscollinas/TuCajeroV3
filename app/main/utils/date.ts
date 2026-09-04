export function nowISO(): string {
  return new Date().toISOString();
}

export function toFileDate(value: Date): string {
  return value.toISOString().replace(/[:.]/g, '-');
}

export function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Devuelve "YYYY-MM-DD" en la zona horaria local del equipo (no UTC). */
export function toLocalIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Convierte una fecha "YYYY-MM-DD" a medianoche en la zona horaria local del equipo. */
export function parseLocalDateOnly(value: string): Date {
  const parts = value.split('-').map(Number);
  const year = parts[0] ?? new Date().getFullYear();
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/** Devuelve un nuevo Date desplazado N días (límite exclusivo del día final). */
export function addDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}
