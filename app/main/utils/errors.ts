export enum ErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION = 'VALIDATION',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  DUPLICATE_CODE = 'DUPLICATE_CODE',
  PRODUCT_NOT_FOUND = 'PRODUCT_NOT_FOUND',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  PRODUCT_EXPIRED = 'PRODUCT_EXPIRED',
  PAYMENT_MISMATCH = 'PAYMENT_MISMATCH',
  EMPTY_CART = 'EMPTY_CART',
  NO_OPEN_SESSION = 'NO_OPEN_SESSION',
  SESSION_ALREADY_OPEN = 'SESSION_ALREADY_OPEN',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  TOO_MANY_ATTEMPTS = 'TOO_MANY_ATTEMPTS',
}

export class AppError extends Error {
  public code: string;

  constructor(code: ErrorCode | string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AppError';
  }
}

export function toApiError(err: unknown): { code: string; message: string } {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: err.message };
  }
  return { code: 'INTERNAL_ERROR', message: 'Error desconocido' };
}
