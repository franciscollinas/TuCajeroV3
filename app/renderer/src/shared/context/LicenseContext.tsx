import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { trpc } from '../../trpc';
import { useAuth } from './AuthContext';

export interface LicenseStatus {
  status: 'valid' | 'invalid' | 'none';
  license: {
    fingerprint: string;
    expiryDate: string;
    signature: string;
  } | null;
  validation: {
    valid: boolean;
    reason?: string;
    expiryDate?: string;
    daysRemaining?: number;
  } | null;
  trial: {
    firstRunDate: string | null;
    trialRemainingHours: number;
    trialRemainingMinutes: number;
    trialRemainingSeconds: number;
    trialActive: boolean;
    trialBlocked: boolean;
  };
}

interface LicenseContextType {
  licenseInfo: LicenseStatus | null;
  isLoading: boolean;
  isValid: boolean;
  isTrial: boolean;
  isBlocked: boolean;
  refresh: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

export function LicenseProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useAuth();
  const [licenseInfo, setLicenseInfo] = useState<LicenseStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    try {
      const info = await trpc.license.getStatus.query();
      setLicenseInfo(info);
    } catch {
      // mantener el último estado conocido
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setLicenseInfo(null);
    setIsLoading(true);
    void refresh();

    if (!user) return;
    const interval = setInterval(() => {
      void refresh();
    }, 60000);
    return () => clearInterval(interval);
  }, [user, refresh]);

  const isValid = licenseInfo?.status === 'valid';
  const isBlocked = licenseInfo?.trial?.trialBlocked === true;
  const isTrial = !!licenseInfo && !isValid && !isBlocked;

  return (
    <LicenseContext.Provider value={{ licenseInfo, isLoading, isValid, isTrial, isBlocked, refresh }}>
      {children}
    </LicenseContext.Provider>
  );
}

export function useLicense(): LicenseContextType {
  const context = useContext(LicenseContext);
  if (!context) throw new Error('useLicense debe usarse dentro de LicenseProvider');
  return context;
}
