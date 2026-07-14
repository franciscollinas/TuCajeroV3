import React from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage?: string;
  className?: string;
  selectedKey?: string | number | null;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({ columns, data, keyExtractor, emptyMessage = 'No hay datos', className = '', selectedKey, onRowClick }: DataTableProps<T>): JSX.Element {
  return (
    <div className={`tc-table-wrap ${className}`}>
      <table className="tc-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.className ?? ''}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={columns.length} className="text-center py-6 text-gray-400">{emptyMessage}</td></tr>
          ) : (
            data.map((row) => {
              const key = keyExtractor(row);
              const isSelected = selectedKey != null && selectedKey === key;
              return (
                <tr
                  key={key}
                  className={`${isSelected ? 'tc-row-selected' : ''} ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={col.className ?? ''}>
                      {col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as React.ReactNode}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
