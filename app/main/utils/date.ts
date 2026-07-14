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
