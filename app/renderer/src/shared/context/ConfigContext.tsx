import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { trpc } from '../../trpc';

interface BusinessConfig {
  businessName: string;
  address: string;
  email: string;
  phone: string;
  nit: string;
  logo: string;
  ivaRate: number;
}

interface ConfigContextType {
  config: BusinessConfig | null;
  loaded: boolean;
  refresh: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextType>({
  config: null,
  loaded: false,
  refresh: async () => {},
});

export function ConfigProvider({ children }: { children: ReactNode }): JSX.Element {
  const [config, setConfig] = useState<BusinessConfig | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = async () => {
    try {
      const data = await trpc.config.getBusiness.query();
      setConfig(data);
    } catch {
      // keep null
    }
    setLoaded(true);
  };

  useEffect(() => { refresh(); }, []);

  return (
    <ConfigContext.Provider value={{ config, loaded, refresh }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextType {
  return useContext(ConfigContext);
}
