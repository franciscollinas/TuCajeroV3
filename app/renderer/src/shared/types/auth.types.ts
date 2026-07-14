export type UserRole = 'ADMIN' | 'CASHIER' | 'SUPERVISOR';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  fullName: string;
  mustChangePassword: boolean;
  branchId: number | null;
  branchName?: string | null;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}
