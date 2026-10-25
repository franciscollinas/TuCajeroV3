import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;
type CheckResult = { isUpdateAvailable: boolean; updateInfo: { version: string } } | null;

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => void>(),
  checkForUpdates: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '3.2.6' } }));
vi.mock('../app/main/utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: (event: string, handler: Handler) => { mocks.handlers.set(event, handler); },
    removeAllListeners: () => { mocks.handlers.clear(); },
    checkForUpdates: () => mocks.checkForUpdates(),
    downloadUpdate: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn(),
  },
}));

const fakeWindow = () => ({ isDestroyed: () => false, webContents: { send: vi.fn() }, on: vi.fn() });

describe('botón «Buscar actualizaciones» (lógica del proceso principal)', () => {
  let updater: typeof import('../app/main/updater');

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mocks.handlers.clear();
    mocks.checkForUpdates.mockReset();
    updater = await import('../app/main/updater');
  });

  afterEach(() => {
    updater.cancelAutoUpdater();
    vi.useRealTimers();
  });

  it('sin la app instalada (actualizador sin activar) dice que no está disponible y no consulta nada', async () => {
    await expect(updater.checkForUpdatesNow()).resolves.toEqual({ status: 'unavailable' });
    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
  });

  it('si ya tiene la última versión, lo dice con su versión', async () => {
    updater.setupAutoUpdater(fakeWindow() as never);
    mocks.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: '3.2.6' } } satisfies CheckResult);
    await expect(updater.checkForUpdatesNow()).resolves.toEqual({ status: 'up-to-date', version: '3.2.6' });
  });

  it('si hay una versión nueva, la anuncia (la descarga sola la hace el actualizador)', async () => {
    updater.setupAutoUpdater(fakeWindow() as never);
    mocks.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '3.2.7' } } satisfies CheckResult);
    await expect(updater.checkForUpdatesNow()).resolves.toEqual({ status: 'available', version: '3.2.7' });
  });

  it('sin internet o con GitHub caído devuelve un error en vez de romper la pantalla', async () => {
    updater.setupAutoUpdater(fakeWindow() as never);
    mocks.checkForUpdates.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'));
    await expect(updater.checkForUpdatesNow()).resolves.toEqual({ status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' });
  });

  it('dos búsquedas a la vez comparten una sola consulta, y después se puede volver a buscar', async () => {
    updater.setupAutoUpdater(fakeWindow() as never);
    let finish: (value: CheckResult) => void = () => undefined;
    mocks.checkForUpdates.mockReturnValueOnce(new Promise<CheckResult>((resolve) => { finish = resolve; }));

    const first = updater.checkForUpdatesNow();
    const second = updater.checkForUpdatesNow();
    finish({ isUpdateAvailable: false, updateInfo: { version: '3.2.6' } });

    expect(await first).toEqual({ status: 'up-to-date', version: '3.2.6' });
    expect(await second).toEqual({ status: 'up-to-date', version: '3.2.6' });
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1);

    mocks.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: { version: '3.2.7' } });
    await expect(updater.checkForUpdatesNow()).resolves.toEqual({ status: 'available', version: '3.2.7' });
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('si la actualización ya se descargó, avisa que falta reiniciar sin volver a consultar', async () => {
    updater.setupAutoUpdater(fakeWindow() as never);
    mocks.handlers.get('update-downloaded')?.({ version: '3.2.7' });
    await expect(updater.checkForUpdatesNow()).resolves.toEqual({ status: 'downloaded', version: '3.2.7' });
    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
  });

  it('la búsqueda automática (5 segundos después de abrir) usa la misma lógica', async () => {
    updater.setupAutoUpdater(fakeWindow() as never);
    mocks.checkForUpdates.mockResolvedValue({ isUpdateAvailable: false, updateInfo: { version: '3.2.6' } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
