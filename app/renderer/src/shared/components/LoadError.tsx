import { AlertTriangle, RefreshCw } from 'lucide-react';

import { EmptyState } from './EmptyState';

interface LoadErrorProps {
  /** Qué no se pudo cargar, en palabras del usuario: «el resumen de caja». */
  what: string;
  /** Detalle técnico del error, si lo hay. */
  detail?: string | null;
  onRetry: () => void;
  className?: string;
}

/**
 * Pantalla de error al cargar datos. Antes, si algo fallaba, la pantalla quedaba vacía o
 * con ceros sin avisar, y un cajero no tenía forma de saber que las cifras no eran reales.
 */
export function LoadError({ what, detail, onRetry, className = 'py-16' }: LoadErrorProps): JSX.Element {
  // Un error técnico en bruto (JSON de validación, trazas) no le sirve a quien está en la caja.
  const readable = detail && !/^\s*[[{]/.test(detail) && detail.length < 200 ? detail : null;
  return (
    <div role="alert">
      <EmptyState
        icon={AlertTriangle}
        title={`No se pudo cargar ${what}`}
        description={readable ? `${readable} Inténtalo de nuevo.` : 'Inténtalo de nuevo. Si sigue fallando, cierra y abre la aplicación.'}
        className={className}
        action={
          <button type="button" onClick={onRetry} className="tc-btn tc-btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: '44px' }}>
            <RefreshCw size={16} />
            Reintentar
          </button>
        }
      />
    </div>
  );
}
