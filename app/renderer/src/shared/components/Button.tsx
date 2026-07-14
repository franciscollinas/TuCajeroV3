import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
  loading?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'tc-btn-primary',
  secondary: 'tc-btn-secondary',
  ghost: 'tc-btn-ghost',
  danger: 'tc-btn-danger',
  success: 'tc-btn-success',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'tc-btn-sm',
  md: '',
  lg: 'tc-btn-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, block, loading, className = '', children, disabled, type = 'button', ...rest },
  ref,
): JSX.Element {
  const classes = [
    'tc-btn',
    variantClass[variant],
    sizeClass[size],
    block ? 'w-full' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || loading} {...rest}>
      {loading && <span className="tc-spinner" style={{ width: 16, height: 16, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block' }} aria-hidden="true" />}
      {!loading && icon}
      {children}
      {!loading && iconRight}
    </button>
  );
});
