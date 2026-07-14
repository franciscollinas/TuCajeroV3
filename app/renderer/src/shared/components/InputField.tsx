import { InputHTMLAttributes, ReactNode } from 'react';

export interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: ReactNode;
}

export function InputField({ label, icon, className = '', ...props }: InputFieldProps): JSX.Element {
  return (
    <div className="tc-field">
      {label && <label className="tc-label">{label}</label>}
      <div className="relative flex items-center">
        {icon && <div className="absolute left-3 text-gray-400 pointer-events-none flex">{icon}</div>}
        <input className={`tc-input ${icon ? 'pl-10' : ''} ${className}`} {...props} />
      </div>
    </div>
  );
}
