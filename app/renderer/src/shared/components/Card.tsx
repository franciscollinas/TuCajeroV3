import { ReactNode, CSSProperties } from 'react';

export interface CardProps {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  interactive?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Card({ title, subtitle, icon, actions, footer, interactive, children, className = '', style }: CardProps): JSX.Element {
  const classes = ['tc-card', interactive ? 'tc-card--interactive' : '', className].filter(Boolean).join(' ');
  return (
    <div className={classes} style={style}>
      {(title || actions || icon) && (
        <div className="flex justify-between items-start mb-4 gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {icon && <div className="tc-metric-icon tc-metric-icon--indigo flex-shrink-0">{icon}</div>}
            <div className="min-w-0">
              {title && <h3 className="tc-display text-lg font-semibold text-gray-900 m-0 truncate">{title}</h3>}
              {subtitle && <p className="text-sm text-gray-500 mt-1 mb-0">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex gap-2 flex-shrink-0">{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="mt-4 pt-4 border-t border-gray-200">{footer}</div>}
    </div>
  );
}
