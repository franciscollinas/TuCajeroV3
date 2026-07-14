import { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export interface LoadingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  children: ReactNode;
}

const variantClasses = {
  primary: 'tc-btn-primary',
  secondary: 'tc-btn-secondary',
  danger: 'tc-btn-danger',
  ghost: 'tc-btn-ghost',
};

export function LoadingButton({ loading, variant = 'primary', size = 'md', children, className = '', disabled, ...props }: LoadingButtonProps): JSX.Element {
  const sizeClass = size === 'sm' ? 'tc-btn-sm' : '';
  return (
    <button className={`tc-btn ${sizeClass} ${variantClasses[variant]} ${className}`} disabled={disabled || loading} {...props}>
      {loading && <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" />}
      {children}
    </button>
  );
}
