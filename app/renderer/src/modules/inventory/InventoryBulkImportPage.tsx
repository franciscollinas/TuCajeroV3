import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, Download, FileSpreadsheet, AlertTriangle,
  CheckCircle, XCircle, ArrowLeft,
} from 'lucide-react';
import { trpc } from '../../trpc';
import { useAuth } from '../../shared/context/AuthContext';
import { es } from '../../shared/i18n';
import {
  Card, DataTable, LoadingButton,
} from '../../shared/components';
import type { Column } from '../../shared/components';
import type { BulkImportRow, BulkImportResult } from '../../shared/types/inventory.types';

type CsvRow = Record<string, string>;
type PreviewRow = BulkImportRow & { _valid: boolean; _errors: string[] };

const EXPECTED_HEADERS = ['code', 'barcode', 'name', 'description', 'category', 'categoryColor', 'price', 'cost', 'stock', 'minStock', 'criticalStock', 'expiryDate', 'location'];

function parseCSV(text: string): CsvRow[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else if (ch === '\r' && !inQuotes) {
      continue;
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values: string[] = [];
    let field = '';
    let inFieldQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inFieldQuotes = !inFieldQuotes;
      } else if (ch === ',' && !inFieldQuotes) {
        values.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
    }
    values.push(field.trim());

    const row: CsvRow = {};
    headers.forEach((h, idx) => {
      row[h] = idx < values.length ? values[idx].replace(/^"|"$/g, '') : '';
    });
    rows.push(row);
  }

  return rows;
}

function validatePreviewRows(rows: CsvRow[]): PreviewRow[] {
  return rows.map((r) => {
    const errors: string[] = [];
    if (!r.name?.trim()) errors.push(es.common.required);
    if (!r.price || isNaN(Number(r.price))) errors.push(`${es.inventory.price} inválido`);
    if (!r.cost || isNaN(Number(r.cost))) errors.push(`${es.inventory.cost} inválido`);

    return {
      code: r.code ?? '',
      barcode: r.barcode ?? '',
      name: r.name ?? '',
      description: r.description ?? '',
      category: r.category ?? '',
      categoryColor: r.categoryColor ?? '',
      price: r.price ?? '0',
      cost: r.cost ?? '0',
      stock: r.stock ?? '0',
      minStock: r.minStock ?? '0',
      criticalStock: r.criticalStock ?? '0',
      expiryDate: r.expiryDate ?? '',
      location: r.location ?? '',
      _valid: errors.length === 0,
      _errors: errors,
    };
  });
}

export default function InventoryBulkImportPage(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      setError('El archivo debe ser CSV.');
      return;
    }

    setError(null);
    setResult(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) {
        setError('No se pudo leer el archivo.');
        return;
      }
      const parsed = parseCSV(text);
      const validated = validatePreviewRows(parsed);
      setPreview(validated);
    };
    reader.onerror = () => {
      setError('Error al leer el archivo.');
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!user) return;
    const validRows = preview.filter((r) => r._valid);
    if (validRows.length === 0) return;

    setImporting(true);
    setError(null);
    try {
      const products = validRows.map((r) => ({
        code: r.code,
        barcode: r.barcode || null,
        name: r.name,
        description: r.description || null,
        category: r.category,
        categoryColor: r.categoryColor || null,
        price: r.price,
        cost: r.cost,
        stock: r.stock,
        minStock: r.minStock,
        criticalStock: r.criticalStock,
        expiryDate: r.expiryDate || null,
        location: r.location || null,
      }));

      const importResult = await trpc.inventory.bulkImport.mutate({ products, userId: user.id });
      setResult(importResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al importar productos.');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadExample = () => {
    const headers = EXPECTED_HEADERS.join(',');
    const example = `${headers}\nP001,,Producto de ejemplo,,General,,25000,15000,10,5,2,2026-12-31,Bodega A`;
    const blob = new Blob(['\uFEFF' + example], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ejemplo_importacion.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = preview.filter((r) => r._valid).length;
  const invalidCount = preview.filter((r) => !r._valid).length;

  const previewColumns: Column<PreviewRow>[] = [
    { key: 'code', header: es.inventory.code, render: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { key: 'name', header: es.inventory.name, render: (r) => <span className={r._valid ? '' : 'text-red-600'}>{r.name || <span className="italic text-red-400">{es.common.required}</span>}</span> },
    { key: 'category', header: es.inventory.category },
    { key: 'price', header: es.inventory.price, render: (r) => r.price },
    { key: 'cost', header: es.inventory.cost, render: (r) => r.cost },
    { key: 'stock', header: es.inventory.stock, render: (r) => r.stock },
    {
      key: 'status',
      header: es.inventory.status,
      render: (r) => r._valid
        ? <CheckCircle size={16} className="text-emerald-500" />
        : (
          <div className="flex items-center gap-1" title={r._errors.join('; ')}>
            <AlertTriangle size={16} className="text-red-500" />
            <span className="text-xs text-red-500">{r._errors.length}</span>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/inventory')}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{es.inventory.bulkImport}</h1>
            <p className="text-sm text-gray-500 mt-1">{es.inventory.importHelp}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDownloadExample}
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
        >
          <Download size={16} />
          {es.inventory.downloadExample}
        </button>
      </div>

      {/* ── Upload Area ── */}
      <Card>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center py-16 px-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            dragOver
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 bg-gray-50/50 hover:bg-gray-50 hover:border-gray-400'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="hidden"
          />
          {fileName ? (
            <>
              <FileSpreadsheet size={48} className="text-blue-500 mb-4" />
              <p className="text-base font-medium text-gray-900">{fileName}</p>
              <p className="text-sm text-gray-500 mt-1">
                {preview.length} {es.reports.products} detectados
              </p>
            </>
          ) : (
            <>
              <Upload size={48} className="text-gray-300 mb-4" />
              <p className="text-base font-medium text-gray-700">
                {es.inventory.importInstructions}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                {es.inventory.importFile}
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            <XCircle size={16} />
            {error}
          </div>
        )}
      </Card>

      {/* ── Preview Table ── */}
      {preview.length > 0 && !result && (
        <Card
          title={es.inventory.importPreview}
          actions={
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">
                <span className="text-emerald-600 font-semibold">{validCount}</span> válidos
                {invalidCount > 0 && (
                  <span className="text-red-500 font-semibold ml-1">
                    / {invalidCount} con errores
                  </span>
                )}
              </span>
              <LoadingButton
                onClick={handleImport}
                loading={importing}
                disabled={validCount === 0}
              >
                <Upload size={16} />
                {es.inventory.importCSV}
              </LoadingButton>
            </div>
          }
        >
          <DataTable
            columns={previewColumns}
            data={preview}
            keyExtractor={(row) => row.code ?? row.name}
            emptyMessage={es.common.noResults}
          />
        </Card>
      )}

      {/* ── Import Results ── */}
      {result && (
        <Card title={es.inventory.importResults}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl">
              <CheckCircle size={24} className="text-emerald-600" />
              <div>
                <p className="text-sm text-emerald-600 font-medium">{es.inventory.importCreated}</p>
                <p className="text-2xl font-bold text-emerald-700">{result.created}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl">
              <CheckCircle size={24} className="text-blue-600" />
              <div>
                <p className="text-sm text-blue-600 font-medium">{es.inventory.importUpdated}</p>
                <p className="text-2xl font-bold text-blue-700">{result.updated}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl">
              <XCircle size={24} className="text-red-600" />
              <div>
                <p className="text-sm text-red-600 font-medium">{es.inventory.importErrors}</p>
                <p className="text-2xl font-bold text-red-700">{result.errors.length}</p>
              </div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">{es.inventory.importErrors}:</p>
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {result.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 px-4 py-2.5 text-sm">
                    <AlertTriangle size={14} className="text-red-500 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-gray-500">
                        {typeof err.row === 'number' ? `Fila ${err.row}: ` : `${err.row?.code ?? ''}: `}
                      </span>
                      <span className="text-red-600">{err.error ?? err.message ?? err.code}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end mt-6">
            <LoadingButton onClick={() => navigate('/inventory')} variant="primary">
              {es.inventory.backToInventory}
            </LoadingButton>
          </div>
        </Card>
      )}

      {/* ── Format Help ── */}
      {!result && (
        <Card title={es.inventory.expectedFormat}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  {EXPECTED_HEADERS.map((h) => (
                    <th key={h} className="px-3 py-2 bg-gray-50 text-left font-medium text-gray-600 border border-gray-200 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {EXPECTED_HEADERS.map((h) => (
                    <td key={h} className="px-3 py-2 text-gray-500 border border-gray-200">
                      {h === 'code' && 'Ej: P001'}
                      {h === 'barcode' && 'Opcional'}
                      {h === 'name' && '*'}
                      {h === 'description' && 'Opcional'}
                      {h === 'category' && 'Nombre de categoría'}
                      {h === 'categoryColor' && 'Hex color opcional'}
                      {h === 'price' && '*'}
                      {h === 'cost' && '*'}
                      {h === 'stock' && 'Opcional'}
                      {h === 'minStock' && 'Opcional'}
                      {h === 'criticalStock' && 'Opcional'}
                      {h === 'expiryDate' && 'YYYY-MM-DD'}
                      {h === 'location' && 'Opcional'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
