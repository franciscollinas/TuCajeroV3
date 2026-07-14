import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { trpc } from '../../trpc';
import { authStorageKey } from '../store/auth.store';
import type { AuthUser, UserRole } from '../types/auth.types';
import type { Branch } from '../types/branch.types';

const BRANCH_STORAGE_KEY = 'currentBranchId';
const MAX_IDLE_MS = 30 * 60 * 1000;

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isReady: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthorized: (requiredRoles: UserRole[]) => boolean;
  currentBranch: Branch | null;
  branches: Branch[];
  setCurrentBranch: (branch: Branch) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(authStorageKey);
  } catch {
    return null;
  }
}

function readStoredBranchId(): number | null {
  const val = localStorage.getItem(BRANCH_STORAGE_KEY);
  return val ? Number(val) : null;
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [isReady, setIsReady] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranchState] = useState<Branch | null>(null);

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      if (!token) {
        setIsReady(true);
        return;
      }

      try {
        const user = await trpc.auth.validate.query({ token });
        if (cancelled) return;
        if (user) {
          setUser(user);

          const allBranches = await trpc.branches.list.query();
          if (cancelled) return;
          setBranches(allBranches);

          const storedId = readStoredBranchId();
          const match = storedId ? allBranches.find((b) => b.id === storedId) : null;
          if (match) {
            setCurrentBranchState(match);
          } else if (user.branchId) {
            const userBranch = allBranches.find((b) => b.id === user.branchId);
            if (userBranch) setCurrentBranchState(userBranch);
          } else if (allBranches.length > 0) {
            setCurrentBranchState(allBranches[0]);
          }
        } else {
          sessionStorage.removeItem(authStorageKey);
          setToken(null);
          setUser(null);
        }
      } catch {
        if (!cancelled) {
          sessionStorage.removeItem(authStorageKey);
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setIsReady(true);
      }
    };

    restoreSession();
    return () => { cancelled = true; };
  }, [token]);

  const lastActivityRef = useRef<number>(Date.now());
  const logoutRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    if (!user) return;
    lastActivityRef.current = Date.now();
    const onActivity = () => { lastActivityRef.current = Date.now(); };
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > MAX_IDLE_MS) {
        void logoutRef.current();
      }
    }, 60 * 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(interval);
    };
  }, [user]);

  const handleLogin = async (username: string, password: string) => {
    try {
      const result = await trpc.auth.login.mutate({ username, password });
      sessionStorage.setItem(authStorageKey, result.token);
      setToken(result.token);
      setUser(result.user);

      const allBranches = await trpc.branches.list.query();
      setBranches(allBranches);

      const storedId = readStoredBranchId();
      const match = storedId ? allBranches.find((b) => b.id === storedId) : null;
      if (match) {
        setCurrentBranchState(match);
      } else if (result.user.branchId) {
        const userBranch = allBranches.find((b) => b.id === result.user.branchId);
        if (userBranch) setCurrentBranchState(userBranch);
      } else if (allBranches.length > 0) {
        setCurrentBranchState(allBranches[0]);
      }
    } catch (err) {
      throw err instanceof Error ? err : new Error('No se pudo iniciar sesión.');
    }
  };

  const handleLogout = async () => {
    try {
      if (token) await trpc.auth.logout.mutate({ token });
    } finally {
      sessionStorage.removeItem(authStorageKey);
      localStorage.removeItem(BRANCH_STORAGE_KEY);
      setToken(null);
      setUser(null);
      setBranches([]);
      setCurrentBranchState(null);
    }
  };

  logoutRef.current = handleLogout;

  const setCurrentBranch = useCallback((branch: Branch) => {
    localStorage.setItem(BRANCH_STORAGE_KEY, String(branch.id));
    setCurrentBranchState(branch);
  }, []);

  const isAuthorized = (requiredRoles: UserRole[]) => {
    if (!user) return false;
    return requiredRoles.some((role) => role.toLowerCase() === user.role.toLowerCase());
  };

  return (
    <AuthContext.Provider value={{ user, token, isReady, login: handleLogin, logout: handleLogout, isAuthorized, currentBranch, branches, setCurrentBranch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
