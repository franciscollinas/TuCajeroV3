import { AppError, ErrorCode } from './errors';
import crypto from 'crypto';

export function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new AppError(ErrorCode.VALIDATION, 'La contraseña debe tener al menos 8 caracteres.');
  }
  if (!/[A-Z]/.test(password)) {
    throw new AppError(ErrorCode.VALIDATION, 'La contraseña debe contener al menos una letra mayúscula.');
  }
  if (!/[a-z]/.test(password)) {
    throw new AppError(ErrorCode.VALIDATION, 'La contraseña debe contener al menos una letra minúscula.');
  }
  if (!/[0-9]/.test(password)) {
    throw new AppError(ErrorCode.VALIDATION, 'La contraseña debe contener al menos un número.');
  }
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}
