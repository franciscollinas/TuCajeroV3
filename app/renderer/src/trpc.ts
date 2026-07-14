import { createTRPCProxyClient } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from '../../main/router/index';

export const AUTH_TOKEN_KEY = 'tucajero.auth.token';

declare global {
  interface Window {
    api: {
      trpc: {
        query: (path: string, input?: unknown, token?: string | null) => Promise<{ success: boolean; data?: unknown; error?: { code: string; message: string } }>;
        mutate: (path: string, input?: unknown, token?: string | null) => Promise<{ success: boolean; data?: unknown; error?: { code: string; message: string } }>;
      };
      onUpdateAvailable: (callback: (info: { version: string; releaseDate: string }) => void) => void;
      onUpdateNotAvailable: (callback: () => void) => void;
      onUpdateError: (callback: (error: string) => void) => void;
      onUpdateProgress: (callback: (progress: { percent: number; bytesPerSecond: number; total: number; transferred: number }) => void) => void;
      onUpdateDownloaded: (callback: () => void) => void;
      downloadUpdate: () => Promise<{ success: boolean }>;
      installUpdate: () => Promise<{ success: boolean }>;
      openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      showNotification: (title: string, body: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

function getAuthToken(): string | null {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    function () {
      return (opts) =>
        observable((observer) => {
          const { op } = opts;
          const path = op.path;
          const input = op.input;
          const token = getAuthToken();
          const method = op.type === 'query' ? window.api.trpc.query : window.api.trpc.mutate;

          method(path, input, token)
            .then((result) => {
              if (result.success) {
                observer.next({ result: { data: result.data } });
                observer.complete();
              } else {
                observer.error(new Error(result.error?.message || 'Error desconocido') as any); // eslint-disable-line @typescript-eslint/no-explicit-any
              }
            })
            .catch((err) => {
              observer.error(err);
            });
        });
    },
  ],
});
