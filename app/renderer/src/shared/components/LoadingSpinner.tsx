import { Loader2 } from 'lucide-react';

export interface LoadingSpinnerProps { size?: number; className?: string; label?: string; }

export function LoadingSpinner({ size = 24, className = '', label = 'Cargando' }: LoadingSpinnerProps): JSX.Element {
  return (
    <div className={`inline-flex items-center justify-center ${className}`} role="status" aria-label={label}>
      <Loader2 size={size} className="text-gray-500 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
