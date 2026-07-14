import { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className = '' }: EmptyStateProps): JSX.Element {
  return (
    <div className={`flex flex-col items-center justify-center py-14 px-6 text-center ${className}`}>
      <div className="tc-metric-icon tc-metric-icon--indigo mb-5" style={{ width: 64, height: 64, borderRadius: 'var(--radius-2xl)' }}>
        <Icon size={30} />
      </div>
      <h3 className="tc-display text-lg font-semibold text-gray-800 mb-2">{title}</h3>
      {description && <p className="text-sm text-gray-500 mb-5 max-w-xs leading-relaxed">{description}</p>}
      {action}
    </div>
  );
}
