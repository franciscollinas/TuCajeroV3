/** Resultado de «Buscar actualizaciones» (lo calcula el proceso principal). */
export type UpdateCheckOutcome =
  /** Hay una versión nueva; se descarga sola. */
  | { status: 'available'; version: string }
  /** La versión nueva ya está descargada y se instala al cerrar la aplicación. */
  | { status: 'downloaded'; version: string }
  /** Ya tiene la última versión. */
  | { status: 'up-to-date'; version: string }
  /** Solo se busca en la aplicación instalada, no en desarrollo. */
  | { status: 'unavailable' }
  /** No se pudo consultar (sin internet, GitHub no responde...). */
  | { status: 'error'; message: string };
