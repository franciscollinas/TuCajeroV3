type LogLevel = 'error' | 'warn';

function log(level: LogLevel, scope: string, args: unknown[]): void {
  const tag = `[TuCajero][${scope}]`;
  if (level === 'error') {
    console.error(tag, ...args);
  } else {
    console.warn(tag, ...args);
  }
}

export const rendererLogger = {
  error: (scope: string, ...args: unknown[]): void => log('error', scope, args),
  warn: (scope: string, ...args: unknown[]): void => log('warn', scope, args),
};
