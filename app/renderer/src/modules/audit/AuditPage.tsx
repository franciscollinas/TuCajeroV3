import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, RefreshCw, Shield } from 'lucide-react';
import { trpc } from '../../trpc';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { EmptyState } from '../../shared/components/EmptyState';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { formatDateTime } from '../../shared/utils/formatters';
import { rendererLogger } from '../../shared/utils/rendererLogger';

interface AuditEntry { id: number; date: string; user: string; action: string; entity: string; details: string; }

function formatDetails(details: string): string {
  try { return JSON.stringify(JSON.parse(details), null, 2); } catch { return details || '—'; }
}

export default function AuditPage(): JSX.Element {
  const [records, setRecords] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await trpc.audit.list.query({ limit: 100 }) as AuditEntry[]);
    } catch (err) {
      rendererLogger.error('AuditPage', 'Error loading audit records:', err);
      setError(err instanceof Error ? err.message : 'No se pudo cargar el registro de auditoría.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadRecords(); }, [loadRecords]);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="mb-1 flex items-center gap-2 text-sm text-gray-500"><Shield size={16} /><span>{es.audit.title}</span><ChevronRight size={14} /><span className="font-semibold text-indigo-600">{es.audit.subtitle}</span></div>
        <h1 className="text-2xl font-bold text-gray-900">{es.audit.title}</h1>
        <p className="text-sm text-gray-500">Consulta las últimas 100 acciones registradas en el sistema.</p>
      </div>
      <button type="button" onClick={() => void loadRecords()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} />Actualizar</button>
    </div>
    <Card>
      {loading ? <div className="flex h-64 items-center justify-center"><LoadingSpinner size={40} /></div>
        : error ? <EmptyState icon={Shield} title="No se pudo cargar la auditoría" description={error} />
        : records.length === 0 ? <EmptyState icon={Shield} title="Sin registros de auditoría" description="Las próximas acciones críticas aparecerán aquí." />
        : <div className="max-h-[65vh] overflow-auto rounded-lg border border-gray-200"><table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Acción</th><th className="px-4 py-3">Entidad</th><th className="px-4 py-3">Detalle</th></tr></thead>
            <tbody>{records.map((record) => <tr key={record.id} className="border-t border-gray-100 align-top hover:bg-gray-50"><td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatDateTime(record.date)}</td><td className="px-4 py-3 font-medium text-gray-800">{record.user}</td><td className="px-4 py-3 text-indigo-700">{record.action}</td><td className="px-4 py-3 text-gray-700">{record.entity}</td><td className="max-w-md px-4 py-3"><pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-600">{formatDetails(record.details)}</pre></td></tr>)}</tbody>
          </table></div>}
    </Card>
  </div>;
}
