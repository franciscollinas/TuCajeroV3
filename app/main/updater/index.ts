import { autoUpdater } from 'electron-updater';
import { BrowserWindow } from 'electron';
import { logger } from '../utils/logger';

let updateTimer: ReturnType<typeof setTimeout> | null = null;

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.autoDownload = false;
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

  const onNotAvailable = () => { logger.info('No updates available'); };
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
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('update:downloaded');
  };
  autoUpdater.on('update-downloaded', onDownloaded);

  updateTimer = setTimeout(() => {
    updateTimer = null;
    autoUpdater.checkForUpdates().catch((err) => { logger.warn({ err }, 'Failed to check for updates'); });
  }, 5000);

  mainWindow.on('closed', () => { cancelAutoUpdater(); });
}

export function cancelAutoUpdater(): void {
  if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
  autoUpdater.removeAllListeners();
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch((err) => { logger.error({ err }, 'Failed to download update'); });
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true);
}
