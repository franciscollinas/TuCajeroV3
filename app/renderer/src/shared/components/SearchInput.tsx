import { Search } from 'lucide-react';
import { es } from '../i18n';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder = es.common.search, className = '' }: SearchInputProps): JSX.Element {
  return (
    <div className={`relative flex items-center ${className}`}>
      <Search size={18} className="absolute left-3.5 text-gray-400 pointer-events-none" />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="tc-input pl-10" />
    </div>
  );
}
