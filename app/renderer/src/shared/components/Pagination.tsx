import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps): JSX.Element | null {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-30 hover:bg-gray-50 cursor-pointer disabled:cursor-not-allowed">
        <ChevronLeft size={16} />
      </button>
      <span className="text-sm text-gray-600">{page} / {totalPages}</span>
      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-30 hover:bg-gray-50 cursor-pointer disabled:cursor-not-allowed">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
