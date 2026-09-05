import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Calendar, ChevronDown, ChevronRight, Download, FileSpreadsheet, FileClock, List, RefreshCw, Save, Shield } from 'lucide-react';
import { trpc } from '../../trpc';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { EmptyState } from '../../shared/components/EmptyState';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { formatDateTime } from '../../shared/utils/formatters';
import { rendererLogger } from '../../shared/utils/rendererLogger';

interface AuditEntry { id: number; date: string; user: string; action: string; entity: string; details: string; }

interface DailyAuditUser { userId: number; userName: string; total: number; actions: Record<string, number>; }
interface DailyLog {
  id: number;
  date: string;
  summary: { date: string; totalEvents: number; byUser: DailyAuditUser[] };
  createdAt: string;
  updatedAt: string;
}

function formatDetails(details: string): string {
  try { return JSON.stringify(JSON.parse(details), null, 2); } catch { return details || '—'; }
}

// "yyyy-mm-dd" → "dd/mm/yyyy" sin pasar por Date (evita corrimientos por zona horaria).
function formatDay(day: string): string {
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

async function openExportedFile(path?: string): Promise<void> {
  if (!path) {
    alert(es.audit.downloadFailed);
    return;
  }
  if (window.api?.openFile) {
    const result = await window.api.openFile(path);
    if (!result.success) alert(result.error || es.audit.downloadFailed);
  }
}

export default function AuditPage(): JSX.Element {
  const [tab, setTab] = useState<'daily' | 'events'>('daily');
  const [range, setRange] = useState({ start: '', end: '' });
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [events, setEvents] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState<'saving' | 'csv' | 'xlsx' | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const startDate = range.start || undefined;
      const endDate = range.end || undefined;
      const [daily, eventList] = await Promise.all([
        trpc.audit.daily.query({ startDate, endDate }) as Promise<DailyLog[]>,
        trpc.audit.list.query({ limit: 200, startDate, endDate }) as Promise<AuditEntry[]>,
      ]);
      setDailyLogs(daily);
      setEvents(eventList);
    } catch (err) {
      rendererLogger.error('AuditPage', 'Error loading audit data:', err);
      setError(err instanceof Error ? err.message : 'No se pudo cargar el registro de auditoría.');
    } finally { setLoading(false); }
  }, [range.start, range.end]);

  useEffect(() => { void loadData(); }, [loadData]);

  const toggleExpand = (id: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSaveToday = async (): Promise<void> => {
    setBusy('saving');
    setFeedback(null);
    try {
      await trpc.audit.saveToday.mutate();
      setFeedback(es.audit.saved);
      await loadData();
    } catch (err) {
      rendererLogger.error('AuditPage', 'Error saving today log:', err);
      setError(err instanceof Error ? err.message : 'No se pudo guardar el log del día.');
    } finally { setBusy(null); }
  };

  const handleDownloadDaily = async (format: 'csv' | 'xlsx'): Promise<void> => {
    setBusy(format);
    setFeedback(null);
    try {
      const result = await trpc.export.dailyAudit.mutate({
        startDate: range.start || undefined,
        endDate: range.end || undefined,
        format,
      });
      await openExportedFile((result as { path: string }).path);
    } catch (err) {
      rendererLogger.error('AuditPage', 'Error exporting daily logs:', err);
      setError(es.audit.downloadFailed);
    } finally { setBusy(null); }
  };

  const handleDownloadEvents = async (format: 'csv' | 'xlsx'): Promise<void> => {
    setBusy(format);
    setFeedback(null);
    try {
      const result = await trpc.export.audit.mutate({
        startDate: range.start || undefined,
        endDate: range.end || undefined,
        format,
      });
      await openExportedFile((result as { path: string }).path);
    } catch (err) {
      rendererLogger.error('AuditPage', 'Error exporting audit events:', err);
      setError(es.audit.downloadFailed);
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm text-gray-500">
            <Shield size={16} />
            <span>{es.audit.title}</span>
            <ChevronRight size={14} />
            <span className="font-semibold text-indigo-600">{es.audit.subtitle}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{es.audit.title}</h1>
          <p className="text-sm text-gray-500">{es.audit.dailyDescription}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void handleSaveToday()} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {busy === 'saving' ? <LoadingSpinner size={16} /> : <Save size={16} />}
            {es.audit.saveToday}
          </button>
          <button type="button" onClick={() => void loadData()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Date range filter */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700"><Calendar size={16} className="text-gray-400" />{es.audit.filterByDate}</span>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">{es.audit.fromDate}</label>
            <input type="date" value={range.start} onChange={(e) => setRange((prev) => ({ ...prev, start: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-500">{es.audit.toDate}</label>
            <input type="date" value={range.end} onChange={(e) => setRange((prev) => ({ ...prev, end: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          {feedback && <span className="text-sm font-medium text-emerald-600">{feedback}</span>}
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'daily'} onClick={() => setTab('daily')} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${tab === 'daily' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <FileClock size={16} />{es.audit.dailyLogs}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${tab === 'events' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <List size={16} />{es.audit.events}
        </button>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center"><LoadingSpinner size={40} /></div>
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="No se pudo cargar la auditoría" description={error} />
      ) : tab === 'daily' ? (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-800">{es.audit.dailyLogs}</h2>
            <div className="flex gap-2">
              <button type="button" onClick={() => void handleDownloadDaily('csv')} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                {busy === 'csv' ? <LoadingSpinner size={16} /> : <FileSpreadsheet size={16} />}CSV
              </button>
              <button type="button" onClick={() => void handleDownloadDaily('xlsx')} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'xlsx' ? <LoadingSpinner size={16} /> : <Download size={16} />}Excel
              </button>
            </div>
          </div>
          {dailyLogs.length === 0 ? (
            <EmptyState icon={FileClock} title={es.audit.noDailyLogs} description={es.audit.dailyDescription} />
          ) : (
            <div className="max-h-[65vh] overflow-auto rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3">{es.audit.day}</th>
                    <th className="px-4 py-3">{es.audit.activities}</th>
                    <th className="px-4 py-3">{es.audit.totalEvents}</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyLogs.map((log) => {
                    const isOpen = expanded.has(log.id);
                    return (
                      <FragmentRow key={log.id} log={log} isOpen={isOpen} onToggle={() => toggleExpand(log.id)} />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-800">{es.audit.events}</h2>
            <div className="flex gap-2">
              <button type="button" onClick={() => void handleDownloadEvents('csv')} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50">
                {busy === 'csv' ? <LoadingSpinner size={16} /> : <FileSpreadsheet size={16} />}CSV
              </button>
              <button type="button" onClick={() => void handleDownloadEvents('xlsx')} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'xlsx' ? <LoadingSpinner size={16} /> : <Download size={16} />}Excel
              </button>
            </div>
          </div>
          {events.length === 0 ? (
            <EmptyState icon={Shield} title={es.audit.empty} description={es.audit.filterByDate} />
          ) : (
            <div className="max-h-[65vh] overflow-auto rounded-lg border border-gray-200">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr><th className="px-4 py-3">{es.audit.date}</th><th className="px-4 py-3">{es.audit.user}</th><th className="px-4 py-3">{es.audit.action}</th><th className="px-4 py-3">{es.audit.entity}</th><th className="px-4 py-3">{es.audit.payload}</th></tr>
                </thead>
                <tbody>
                  {events.map((record) => (
                    <tr key={record.id} className="border-t border-gray-100 align-top hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatDateTime(record.date)}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{record.user}</td>
                      <td className="px-4 py-3 text-indigo-700">{record.action}</td>
                      <td className="px-4 py-3 text-gray-700">{record.entity}</td>
                      <td className="max-w-md px-4 py-3"><pre className="whitespace-pre-wrap break-words font-mono text-xs text-gray-600">{formatDetails(record.details)}</pre></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

interface FragmentRowProps {
  log: DailyLog;
  isOpen: boolean;
  onToggle: () => void;
}

function FragmentRow({ log, isOpen, onToggle }: FragmentRowProps): JSX.Element {
  return (
    <>
      <tr className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={onToggle}>
        <td className="px-4 py-3 font-medium text-gray-800">{formatDay(log.date)}</td>
        <td className="px-4 py-3 text-gray-600">{log.summary.byUser.length} usuario(s)</td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-1 font-semibold text-indigo-700">
            {log.summary.totalEvents}
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-gray-100 bg-gray-50/60">
          <td colSpan={3} className="px-6 py-4">
            <div className="space-y-3">
              {log.summary.byUser.length === 0 ? (
                <p className="text-sm text-gray-500">Sin actividades este día.</p>
              ) : (
                log.summary.byUser.map((user) => {
                  const actions = Object.entries(user.actions).sort(([a], [b]) => a.localeCompare(b));
                  return (
                    <div key={user.userId} className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-800">{user.userName}</span>
                        <span className="text-sm text-gray-500">{user.total} acción(es)</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {actions.map(([action, count]) => (
                          <span key={action} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                            {action}: {count}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}