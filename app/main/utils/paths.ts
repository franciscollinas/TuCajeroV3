import { createRequire } from 'module';
import { resolve } from 'path';

let cachedUserDataPath: string | null | undefined;

type RequireFn = (id: string) => unknown;

// Lazy: este módulo también se importa desde scripts de node (backfill, tests) y
// desde el bundle CJS de Electron, por lo que hay que resolver `require` de forma
// segura en ambos entornos (ESM y CJS).
function getLocalRequire(): RequireFn | null {
  if (typeof __dirname === 'string' && typeof require === 'function') {
    return require as RequireFn;
  }
  // Evita que esbuild deje import.meta vacío al generar el bundle CommonJS.
  return createRequire(resolve(process.cwd(), '__tucajero_require__.js'));
}

// Devuelve la API de Electron solo si este módulo está corriendo dentro de
// Electron empaquetado; en scripts de node, `require('electron')` no la expone.
function getElectronApp(): { isPackaged?: boolean; getPath?: (name: string) => string; getAppPath?: () => string } | null {
  try {
    const requireFn = getLocalRequire();
    if (!requireFn) return null;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = requireFn('electron') as unknown;
    const app = (electron as { app?: unknown } | null)?.app;
    if (app && typeof app === 'object' && typeof (app as { getPath?: unknown }).getPath === 'function') {
      return app as { isPackaged?: boolean; getPath?: (name: string) => string };
    }
  } catch {
    // No estamos dentro de Electron.
  }
  return null;
}

function getUserDataPath(): string | null {
  if (cachedUserDataPath !== undefined) return cachedUserDataPath;
  const electronApp = getElectronApp();
  if (electronApp?.getPath) {
    const userData = electronApp.getPath('userData');
    if (electronApp.isPackaged) {
      cachedUserDataPath = userData;
      return userData;
    }
  }
  cachedUserDataPath = null;
  return null;
}

// Directorio base de la app: en desarrollo es el cwd del proyecto; en la app
// empaquetada, `app.getPath('userData')` (independiente del cwd del ejecutable).
export function getAppDataDir(): string {
  return getUserDataPath() ?? process.cwd();
}

export const DATABASE_PATH = process.env.DATABASE_URL || './database/tucajero.db';

export function getDatabasePath(): string {
  const envPath = process.env.DATABASE_URL;
  if (envPath) return resolve(envPath);
  return resolve(getAppDataDir(), 'database', 'tucajero.db');
}

export function getBackupsDir(): string {
  return resolve(getAppDataDir(), 'backups');
}

export function getExportsDir(): string {
  return resolve(getAppDataDir(), 'exports');
}

export function getLabelsDir(): string {
  return resolve(getAppDataDir(), 'exports', 'labels');
}

export function getInvoicesDir(): string {
  return resolve(getAppDataDir(), 'invoices');
}

// Carpeta con las migraciones de drizzle. En desarrollo vive en el repo; en la
// app empaquetada, dentro del asar (empaquetada por electron-builder).
export function getMigrationsFolder(): string {
  const electronApp = getElectronApp();
  const appPath = electronApp?.getAppPath?.();
  const base = appPath ? resolve(appPath) : process.cwd();
  return resolve(base, 'database', 'migrations');
}
