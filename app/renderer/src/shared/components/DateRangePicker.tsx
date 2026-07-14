export interface DateRange { start: string; end: string; }

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps): JSX.Element {
  return (
    <div className="flex gap-3 items-center">
      <div className="tc-field mb-0"><label className="tc-label">Desde</label>
        <input type="date" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })}
          className="tc-input" />
      </div>
      <div className="tc-field mb-0"><label className="tc-label">Hasta</label>
        <input type="date" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })}
          className="tc-input" />
      </div>
    </div>
  );
}
