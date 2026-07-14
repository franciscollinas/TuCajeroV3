import { SearchInput } from './SearchInput';
import { SelectInput } from './SelectInput';

export interface FilterOption { value: string; label: string; }

export interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filter?: string;
  onFilterChange?: (value: string) => void;
  filterOptions?: FilterOption[];
  placeholder?: string;
}

export function FilterBar({ search, onSearchChange, filter, onFilterChange, filterOptions, placeholder }: FilterBarProps): JSX.Element {
  return (
    <div className="flex gap-3 items-center flex-wrap">
      <div className="flex-1 min-w-[200px]"><SearchInput value={search} onChange={onSearchChange} placeholder={placeholder} /></div>
      {filterOptions && onFilterChange && (
        <SelectInput value={filter} onChange={(e) => onFilterChange(e.target.value)} options={filterOptions} className="w-40" />
      )}
    </div>
  );
}
