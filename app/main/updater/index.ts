import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow } from 'electron';
import { logger } from '../utils/logger';

const INITIAL_CHECK_DELAY_MS = 5000;
const DAILY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let initialCheckTimer: ReturnType<typeof setTimeout> | null = null;
let dailyCheckTimer: ReturnType<typeof setInterval> | null = null;
let checkInProgress = false;
let updatePending = false;

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const onReady = () => { logger.info('Checking for updates...'); };
  autoUpdater.on('checking-for-update', onReady);

  const onAvailable = (info: { version: string; releaseDate: string }) => {
    logger.info({ version: info.version }, 'Update available');
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

  const onDownloaded = () => {
    logger.info('Update downloaded');
    updatePending = true;
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('update:downloaded');
  };
  autoUpdater.on('update-downloaded', onDownloaded);

  const runCheck = () => {
    if (checkInProgress || updatePending) return;
    checkInProgress = true;
    autoUpdater.checkForUpdates().catch((err) => {
      logger.warn({ err }, 'Failed to check for updates');
    }).finally(() => {
      checkInProgress = false;
    });
  };

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
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((err) => { logger.error({ err }, 'Failed to download update'); });
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true);
}
