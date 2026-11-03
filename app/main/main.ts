import { app, BrowserWindow, Menu, session, dialog } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { registerIpc } from './router/ipc-bridge';
import { MigrationService } from './services/migration.service';
import { setupAutoUpdater } from './updater';
import { getDatabase, closeDatabase, setBeforeUpgradeHook, consumeRecoveryNotice } from './db';
import { BackupService } from './services/backup.service';
import { ensureBootstrap } from './services/bootstrap.service';
import { CashSessionService } from './services/cash-session.service';
import { AuditService } from './services/audit.service';
import { logger } from './utils/logger';

process.stdout.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  throw err;
});
process.stderr.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return;
  throw err;
});

const isDev = !app.isPackaged;

const AUTO_CLOSE_INACTIVITY_HOURS = 3;
const AUTO_CLOSE_SWEEP_MS = 5 * 60 * 1000;
const AUTO_BACKUP_DELAY_MS = 20 * 1000;
const AUTO_BACKUP_CHECK_MS = 6 * 60 * 60 * 1000;

// Dos copias abiertas a la vez escribirían sobre la misma base de datos. Solo en la app instalada:
// en desarrollo se pueden abrir varias para probar.
const gotSingleInstanceLock = isDev || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let autoCloseTimer: NodeJS.Timeout | null = null;
let autoBackupTimer: NodeJS.Timeout | null = null;

function loadEnvFile(): void {
  const baseDir = isDev ? process.cwd() : path.dirname(app.getPath('exe'));
  const envPath = path.join(baseDir, '.env');
  if (!existsSync(envPath)) return;

  const envContent = readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const equalIdx = trimmed.indexOf('=');
    if (equalIdx === -1) return;

    const key = trimmed.slice(0, equalIdx).trim();
    let value = trimmed.slice(equalIdx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      process.env[key] = value;
    }
  });
}

loadEnvFile();

function createWindow(): void {
  // En la app instalada no se muestra la barra de menús de Electron (File, Edit, View, Window): no es
  // parte del punto de venta y deja abrir herramientas de desarrollo y recargar. En desarrollo se conserva.
  if (!isDev) Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    icon: path.join(__dirname, '../../build/icon.ico'),
    show: false,
    title: 'TuCajero',
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('http://localhost:5173') || url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Register IPC bridge (tRPC over Electron IPC)
  registerIpc();

  // Set CSP headers for production
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: file: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';",
          ],
          'X-Frame-Options': ['DENY'],
        },
      });
    });
  }

// electron-updater solo cuenta con metadata de publicación en builds
  // empaquetados; en desarrollo hay que activarlo explícitamente con
  // TUCajero_TEST_UPDATE=1 (lee dev-app-update.yml) para probar el flujo.
  if (!isDev || process.env.TUCajero_TEST_UPDATE === '1') setupAutoUpdater(mainWindow);
}

async function sweepInactiveCashSessions(): Promise<void> {
  try {
    const cashSessionService = new CashSessionService();
    const closed = await cashSessionService.autoCloseInactiveSessions(AUTO_CLOSE_INACTIVITY_HOURS);
    if (closed.length > 0) {
      logger.info({ count: closed.length }, 'Auto-closed inactive cash sessions');
      const sessionIds = closed.map((entry) => entry.sessionId);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('cash:session-closed', { sessionIds });
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Auto-close cash sessions sweep failed');
  }
}

function startAutoCloseSweeper(): void {
  void sweepInactiveCashSessions();
  autoCloseTimer = setInterval(() => {
    void sweepInactiveCashSessions();
  }, AUTO_CLOSE_SWEEP_MS);
  autoCloseTimer.unref();
}

app.on('second-instance', () => {
  // Si abren la app otra vez, se trae al frente la ventana que ya existe.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Promesa rechazada sin manejar');
});

/** Copia automática diaria de la base (solo si la última tiene más de 20 horas). Nunca interrumpe la app. */
function runAutoBackup(): void {
  new BackupService()
    .createAutoBackupIfDue()
    .then((entry) => { if (entry) logger.info({ file: entry.fileName }, 'Copia automática de la base de datos creada'); })
    .catch((err) => logger.error({ err }, 'Falló la copia automática de la base de datos'));
}

const peso = (value: number): string => new Intl.NumberFormat('es-CO').format(value);

/**
 * Primera vez que se abre V3 en un equipo que tenía TuCajero V2: ofrece traer los datos. Se hace antes de crear
 * los usuarios de fábrica, así el cliente entra con su usuario y su clave de siempre. La base de V2 solo se
 * lee (queda intacta) y, antes de dar la importación por buena, se comprueba que no falte nada.
 * TUCAJERO_V2_IMPORT=si|no responde sin preguntar (instalaciones automáticas y pruebas).
 */
async function offerV2Import(): Promise<void> {
  const mode = process.env.TUCAJERO_V2_IMPORT;
  if (isDev && !mode) return;
  const declinedMarker = path.join(app.getPath('userData'), 'v2-import-declined.txt');
  if (existsSync(declinedMarker)) return;

  const service = new MigrationService();
  const found = service.detectV2();
  if (!found.available || !found.path) return;

  let accept: boolean;
  if (mode === 'si' || mode === 'no') {
    accept = mode === 'si';
  } else {
    const s = found.summary;
    const content = s
      ? `Se encontraron ${peso(s.sales)} ventas, ${peso(s.products)} productos y ${peso(s.customers)} clientes` +
        (s.firstSale && s.lastSale ? ` (del ${s.firstSale} al ${s.lastSale}).` : '.')
      : 'Se encontró una base de datos de la versión anterior.';
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Importar datos de tu TuCajero anterior',
      message: 'Encontramos los datos de tu TuCajero anterior. ¿Quieres traerlos a esta versión?',
      detail:
        `${content}\n\nTus datos antiguos no se tocan: quedan intactos donde estaban y además se guarda una copia de seguridad. ` +
        'Antes de dar la importación por buena se comprueba que no falte nada; si algo no coincide, no se importa y todo queda como estaba.',
      buttons: ['Importar mis datos', 'Empezar sin datos antiguos'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    accept = response === 0;
  }

  if (!accept) {
    writeFileSync(declinedMarker, `Se eligió empezar sin los datos de V2 el ${new Date().toISOString()}\n`);
    logger.info('El usuario eligió no importar los datos de V2');
    return;
  }

  try {
    const report = await service.migrateV2();
    logger.info({ rows: report.rows, corrections: report.corrections?.length ?? 0, backup: report.backupPath }, 'Datos de V2 importados');
    if (mode) return;
    const corrections = report.corrections ?? [];
    await dialog.showMessageBox({
      type: 'info',
      title: 'Datos importados',
      message: 'Tus datos se importaron y se comprobó que coinciden con los de antes.',
      detail:
        `Ventas: ${peso(report.rows.Sale ?? 0)}\nProductos: ${peso(report.rows.Product ?? 0)}\nClientes: ${peso(report.rows.Customer ?? 0)}\n` +
        `Cierres de caja: ${peso(report.rows.CashSession ?? 0)}\n\n` +
        'Entra con el mismo usuario y la misma clave de antes (se te pedirá cambiarla).\n' +
        (corrections.length > 0
          ? `\nAtención: ${corrections.length} cifra(s) de un cierre de caja tenían un valor imposible (error al digitar). ` +
            'Ese cierre quedó «sin conteo»: en Caja puedes corregirlo con «Conciliar». El valor original quedó en la auditoría.\n'
          : '') +
        `\nCopia de seguridad de tus datos antiguos:\n${report.backupPath}`,
      buttons: ['Entendido'],
      noLink: true,
    });
  } catch (err) {
    logger.error({ err }, 'No se pudieron importar los datos de V2');
    if (mode) return;
    await dialog.showMessageBox({
      type: 'error',
      title: 'No se importaron los datos',
      message: 'No se pudieron importar los datos de tu TuCajero anterior. No se perdió nada.',
      detail:
        'Tus datos antiguos siguen intactos donde estaban y la aplicación se abrirá sin ellos. ' +
        'Cierra la aplicación y avísale a quien te la instaló, mostrándole este mensaje:\n\n' +
        (err instanceof Error ? err.message : String(err)),
      buttons: ['Entendido'],
      noLink: true,
    });
  }
}

function startAutoBackups(): void {
  const first = setTimeout(runAutoBackup, AUTO_BACKUP_DELAY_MS);
  first.unref();
  autoBackupTimer = setInterval(runAutoBackup, AUTO_BACKUP_CHECK_MS);
  autoBackupTimer.unref();
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  try {
    // Antes de que una versión nueva modifique la base, se guarda una copia (una vez por versión).
    setBeforeUpgradeHook((sqlite) => {
      new BackupService({ getRawDatabase: () => sqlite })
        .createPreUpgradeBackupIfNeeded(app.getVersion())
        .catch((err) => logger.error({ err }, 'Falló la copia previa a la actualización'));
    });
    // Initialize database on startup
    getDatabase();
    logger.info('Database initialized');
    // Un fallo aquí no debe impedir abrir la aplicación: se registra y se sigue.
    await offerV2Import().catch((err) => logger.error({ err }, 'Falló la oferta de importar los datos de V2'));
    await ensureBootstrap();

    // Genera (si falta) el log diario de auditoría de los días ya terminados.
    new AuditService()
      .ensureDailyLogsForAllAccounts()
      .then((count) => { if (count > 0) logger.info({ count }, 'Generated daily audit logs'); })
      .catch((err) => logger.error({ err }, 'Daily audit log generation failed'));
  } catch (err) {
    logger.error({ err }, 'Failed to initialize database');
    dialog.showErrorBox(
      'Error de Base de Datos',
      'No se pudo inicializar la base de datos. La aplicacion se cerrara.\n\n' + (err instanceof Error ? err.message : String(err))
    );
    app.quit();
    return;
  }

  createWindow();
  startAutoCloseSweeper();
  startAutoBackups();

  const recovery = consumeRecoveryNotice();
  if (recovery) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Base de datos recuperada',
      message: 'La base de datos estaba dañada y se restauró desde una copia de seguridad.',
      detail: `Copia usada: ${recovery.restoredFrom}.
Lo registrado después de esa copia no se recuperó. El archivo dañado se guardó aparte en:
${recovery.quarantinedTo}`,
    }).catch(() => undefined);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (autoCloseTimer) {
    clearInterval(autoCloseTimer);
    autoCloseTimer = null;
  }
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
  closeDatabase();
});
