import { Check, X, Clock, AlertTriangle } from 'lucide-react';

export type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export interface StatusBadgeProps { status: string; variant?: BadgeVariant; label?: string; className?: string; }

const variantConfig: Record<BadgeVariant, { bg: string; text: string; icon: React.ReactNode }> = {
  success: { bg: '#dcfce7', text: '#166534', icon: <Check size={12} /> },
  danger: { bg: '#fee2e2', text: '#991b1b', icon: <X size={12} /> },
  warning: { bg: '#fef3c7', text: '#92400e', icon: <AlertTriangle size={12} /> },
  info: { bg: '#dbeafe', text: '#1e40af', icon: <Clock size={12} /> },
  neutral: { bg: '#f1f5f9', text: '#475569', icon: null },
};

const statusToVariant: Record<string, BadgeVariant> = {
  active: 'success', enabled: 'success', completed: 'success', paid: 'success', ok: 'success',
  inactive: 'danger', disabled: 'danger', deleted: 'danger', cancelled: 'danger', failed: 'danger', critical: 'danger', expired: 'danger',
  warning: 'warning', pending: 'warning', low: 'warning',
  info: 'info',
};

export function StatusBadge({ status, variant, label, className = '' }: StatusBadgeProps): JSX.Element {
  const resolvedVariant = variant ?? statusToVariant[status.toLowerCase()] ?? 'neutral';
  const config = variantConfig[resolvedVariant];

  return (
    <span className={`tc-badge tc-badge--${resolvedVariant} ${className}`}>
      {config.icon}
      {label ?? status}
    </span>
  );
}
