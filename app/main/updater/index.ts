import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow } from 'electron';
import { logger } from '../utils/logger';
import type { UpdateCheckOutcome } from '../../renderer/src/shared/types/update.types';

const INITIAL_CHECK_DELAY_MS = 5000;
const DAILY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let initialCheckTimer: ReturnType<typeof setTimeout> | null = null;
let dailyCheckTimer: ReturnType<typeof setInterval> | null = null;
let updaterReady = false;
let activeCheck: Promise<UpdateCheckOutcome> | null = null;
let updatePending = false;
let downloadedVersion = '';
let lastAvailableVersion = '';

/**
 * Busca una versión nueva. Si ya hay una búsqueda en curso (la automática o la del botón), comparte su
 * resultado en vez de lanzar otra; si ya hay una actualización descargada, lo avisa sin volver a buscar.
 */
export function checkForUpdatesNow(): Promise<UpdateCheckOutcome> {
  if (!updaterReady) return Promise.resolve({ status: 'unavailable' });
  if (updatePending) return Promise.resolve({ status: 'downloaded', version: downloadedVersion || lastAvailableVersion });
  if (activeCheck) return activeCheck;

  activeCheck = autoUpdater
    .checkForUpdates()
    .then((result): UpdateCheckOutcome => {
      if (result?.isUpdateAvailable) return { status: 'available', version: result.updateInfo.version };
      return { status: 'up-to-date', version: app.getVersion() };
    })
    .catch((err): UpdateCheckOutcome => {
      logger.warn({ err }, 'Failed to check for updates');
      return { status: 'error', message: err instanceof Error ? err.message : 'Error desconocido.' };
    })
    .finally(() => {
      activeCheck = null;
    });
  return activeCheck;
}

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  updaterReady = true;

  const onReady = () => { logger.info('Checking for updates...'); };
  autoUpdater.on('checking-for-update', onReady);

  const onAvailable = (info: { version: string; releaseDate: string }) => {
    logger.info({ version: info.version }, 'Update available');
    lastAvailableVersion = info.version;
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', { version: info.version, releaseDate: info.releaseDate });
    }
  };
  autoUpdater.on('update-available', onAvailable);

  const onNotAvailable = () => {
    logger.info('No updates available');
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('update:not-available');
  };
  autoUpdater.on('update-not-available', onNotAvailable);

  const onError = (err: Error) => {
    logger.error({ err }, 'Update error');
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('update:error', err.message);
  };
  autoUpdater.on('error', onError);

  const onProgress = (progress: { percent: number; bytesPerSecond: number; total: number; transferred: number }) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:progress', {
        percent: progress.percent, bytesPerSecond: progress.bytesPerSecond,
        total: progress.total, transferred: progress.transferred,
      });
    }
  };
  autoUpdater.on('download-progress', onProgress);

  const onDownloaded = (info?: { version?: string }) => {
    logger.info('Update downloaded');
    updatePending = true;
    downloadedVersion = info?.version ?? lastAvailableVersion;
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('update:downloaded');
  };
  autoUpdater.on('update-downloaded', onDownloaded);

  const runCheck = () => { void checkForUpdatesNow(); };

  initialCheckTimer = setTimeout(() => {
    initialCheckTimer = null;
    runCheck();
  }, INITIAL_CHECK_DELAY_MS);

  dailyCheckTimer = setInterval(runCheck, DAILY_CHECK_INTERVAL_MS);

  mainWindow.on('closed', () => { cancelAutoUpdater(); });
}

export function cancelAutoUpdater(): void {
  if (initialCheckTimer) { clearTimeout(initialCheckTimer); initialCheckTimer = null; }
  if (dailyCheckTimer) { clearInterval(dailyCheckTimer); dailyCheckTimer = null; }
  autoUpdater.removeAllListeners();
  updaterReady = false;
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((err) => { logger.error({ err }, 'Failed to download update'); });
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true);
}
