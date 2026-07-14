import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types/auth.types';

export type Permission =
  | 'sales:all' | 'sales:create' | 'sales:view-own'
  | 'inventory:all' | 'inventory:view' | 'inventory:search'
  | 'users:all'
  | 'settings:all'
  | 'reports:all'
  | 'audit:view'
  | 'cash-session:all' | 'cash-session:open' | 'cash-session:close-own'
  | 'backup:all';

const permissions: Record<UserRole, Permission[]> = {
  ADMIN: [
    'sales:all', 'sales:create', 'sales:view-own',
    'inventory:all', 'inventory:view', 'inventory:search',
    'users:all', 'settings:all', 'reports:all', 'audit:view',
    'cash-session:all', 'cash-session:open', 'cash-session:close-own', 'backup:all',
  ],
  CASHIER: [
    'sales:create', 'sales:view-own',
    'inventory:view', 'inventory:search',
    'cash-session:open', 'cash-session:close-own',
  ],
  SUPERVISOR: [
    'sales:create', 'sales:view-own',
    'inventory:all', 'inventory:view', 'inventory:search',
    'reports:all', 'users:all',
    'cash-session:all', 'cash-session:open', 'cash-session:close-own',
  ],
};

export function useRBAC(): { can: (permission: Permission) => boolean } {
  const { user } = useAuth();

  return {
    can: (permission: Permission) => {
      if (!user) return false;
      return permissions[user.role]?.includes(permission) ?? false;
    },
  };
}
