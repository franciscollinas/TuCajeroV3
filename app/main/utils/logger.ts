import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

const isDev = !app.isPackaged;

function getLogger(): pino.Logger {
  if (isDev) {
    return pino({
      level: 'debug',
      transport: {
        target: 'pino/file',
        options: { destination: 1 },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'app.log');

  return pino(
    {
      level: 'info',
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination(logFile),
  );
}

export const logger = getLogger();
