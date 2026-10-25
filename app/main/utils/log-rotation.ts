import { existsSync, renameSync, statSync, unlinkSync } from 'fs';

/**
 * Rota un archivo de registro si pasó de `maxBytes`: app.log → app.log.1 → app.log.2 …
 * y descarta el más antiguo. Se llama al arrancar, antes de abrir el archivo; el registro
 * de una tienda que lleva años abierta ya no crece sin límite.
 */
export function rotateLogIfNeeded(logFile: string, maxBytes = 5 * 1024 * 1024, keep = 3): void {
  try {
    if (!existsSync(logFile) || statSync(logFile).size < maxBytes) return;

    const oldest = `${logFile}.${keep}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = keep - 1; i >= 1; i--) {
      const from = `${logFile}.${i}`;
      if (existsSync(from)) renameSync(from, `${logFile}.${i + 1}`);
    }
    renameSync(logFile, `${logFile}.1`);
  } catch {
    // Si no se puede rotar (archivo en uso), se sigue escribiendo en el mismo: nunca bloquea el arranque.
  }
}
