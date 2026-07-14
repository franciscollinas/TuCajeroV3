import { useAuth } from '../context/AuthContext';
import type { AuthUser } from '../types/auth.types';

/**
 * Devuelve el usuario autenticado. Las páginas que usan este hook están
 * envueltas en <ProtectedRoute>, que ya redirige a /login cuando el usuario
 * es null. El valor de retorno se tipa como no-nulo para evitar las
 * afirmaciones `user!` en los handlers.
 */
export function useRequireUser(): AuthUser {
  const { user } = useAuth();
  return user as AuthUser;
}
