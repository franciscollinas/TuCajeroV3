import { SelectHTMLAttributes } from 'react';

export interface SelectInputProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export function SelectInput({ label, options, className = '', ...props }: SelectInputProps): JSX.Element {
  return (
    <div className="tc-field">
      {label && <label className="tc-label">{label}</label>}
      <select className={`tc-input ${className}`} {...props}>
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </div>
  );
}
