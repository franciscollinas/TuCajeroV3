export interface LoadingSpinnerProps { size?: number; className?: string; label?: string; }

export function LoadingSpinner({ size = 24, className = '', label = 'Cargando' }: LoadingSpinnerProps): JSX.Element {
  return (
    <div className={`inline-flex items-center justify-center ${className}`} role="status" aria-label={label}>
      <span className="tc-aurora-spinner animate-spin" style={{ width: size, height: size }} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
