import { useState, useEffect, useCallback } from 'react';
import { Database, HardDrive, Upload, Download, Trash2, RefreshCw, ChevronRight, Clock, Import, CheckCircle2, AlertTriangle } from 'lucide-react';
import { trpc } from '../../trpc';
import { es } from '../../shared/i18n';
import { formatDateTime } from '../../shared/utils/formatters';
import { Card } from '../../shared/components/Card';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { EmptyState } from '../../shared/components/EmptyState';
import { ConfirmDialog } from '../../shared/components/ConfirmDialog';

interface BackupEntry {
  id: string;
  fileName: string;
  createdAt: string;
  size: string;
  valid: boolean;
}

interface MigrationDetection {
  available: boolean;
  path: string | null;
  size: string | null;
  alreadyMigrated: boolean;
}

interface MigrationReport {
  migrated: boolean;
  sourcePath: string;
  backupPath: string;
  accountId: number;
  rows: Record<string, number>;
  integrity: string;
}

export default function BackupPage(): JSX.Element {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [dbInfo, setDbInfo] = useState<{ path: string; size: string; lastBackup: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [migration, setMigration] = useState<MigrationDetection | null>(null);
  const [migrationLoading, setMigrationLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationReport | null>(null);
  const [confirmMigration, setConfirmMigration] = useState(false);

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  const fetchMigration = useCallback(async () => {
    setMigrationLoading(true);
    try {
      const detection = await trpc.migration.detect.query();
      setMigration(detection as MigrationDetection);
    } catch {
      setMigration(null);
    } finally {
      setMigrationLoading(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [list, info] = await Promise.all([
        trpc.backup.list.query(),
        trpc.backup.dbInfo.query(),
      ]);
      setBackups(list as BackupEntry[]);
      setDbInfo(info as typeof dbInfo);
    } catch {
      showMessage('Error al cargar datos de backup.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchMigration(); }, [fetchMigration]);

  const handleMigrate = async () => {
    setMigrating(true);
    setConfirmMigration(false);
    try {
      const result = await trpc.migration.importV2.mutate();
      setMigrationResult(result as MigrationReport);
      await fetchMigration();
      showMessage('Migración completada correctamente.', 'success');
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Error al migrar los datos.', 'error');
    } finally {
      setMigrating(false);
    }
  };

  const handleCreateBackup = async () => {
    setCreating(true);
    try {
      await trpc.backup.create.mutate();
      await fetchData();
      showMessage('Copia de seguridad creada correctamente.', 'success');
    } catch {
      showMessage('Error al crear copia de seguridad.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (id: string) => {
    setRestoring(id);
    setConfirmRestore(null);
    try {
      await trpc.backup.restore.mutate({ id });
      showMessage('Restauración completada.', 'success');
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Error al restaurar.', 'error');
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    setConfirmDelete(null);
    try {
      await trpc.backup.delete.mutate({ id });
      await fetchData();
      showMessage('Copia de seguridad eliminada.', 'success');
    } catch {
      showMessage('Error al eliminar copia.', 'error');
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
          <HardDrive size={16} />
          <span>{es.backup.title}</span>
          <ChevronRight size={14} />
          <span className="text-indigo-600 font-semibold">{es.backup.subtitle}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{es.backup.title}</h1>
        <p className="text-sm text-gray-500">{es.backup.subtitle}</p>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
          messageType === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      <div className="tc-grid-3">
        <Card>
          <div className="flex items-center gap-3 mb-2">
            <div className="tc-metric-icon" style={{ background: '#eef2ff' }}>
              <Database size={20} className="text-indigo-600" />
            </div>
          </div>
          <p className="text-sm text-gray-500">{es.backup.databasePath}</p>
          <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">
            {dbInfo?.path ?? 'database/tucajero.db'}
          </p>
        </Card>
        <Card>
          <div className="flex items-center gap-3 mb-2">
            <div className="tc-metric-icon" style={{ background: '#ecfdf3' }}>
              <HardDrive size={20} className="text-emerald-600" />
            </div>
          </div>
          <p className="text-sm text-gray-500">{es.backup.databaseSize}</p>
          <p className="text-sm font-semibold text-gray-800 mt-0.5">{dbInfo?.size ?? '--'}</p>
        </Card>
        <Card>
          <div className="flex items-center gap-3 mb-2">
            <div className="tc-metric-icon" style={{ background: '#fffaeb' }}>
              <Clock size={20} className="text-amber-600" />
            </div>
          </div>
          <p className="text-sm text-gray-500">{es.backup.lastBackup}</p>
          <p className="text-sm font-semibold text-gray-800 mt-0.5">
            {dbInfo?.lastBackup ? formatDateTime(dbInfo.lastBackup) : 'Nunca'}
          </p>
        </Card>
      </div>

      <div className="flex justify-end">
        <LoadingButton onClick={handleCreateBackup} loading={creating}>
          <Upload size={16} />
          {es.backup.createBackup}
        </LoadingButton>
      </div>

      <Card title={es.backup.migrateTitle} subtitle={es.backup.migrateSubtitle}>
        {migrationLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
            <LoadingSpinner size={16} />
            {es.backup.migrateLoading}
          </div>
        ) : migration?.alreadyMigrated ? (
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="text-emerald-500 mt-0.5 shrink-0" />
            <div className="text-sm text-gray-700">{es.backup.migrateAlreadyDone}</div>
          </div>
        ) : migration?.available && migration.path ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Import size={20} className="text-indigo-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-gray-800">{es.backup.migrateFound}</p>
                <p className="text-gray-500 mt-0.5">
                  <span className="font-medium">{es.backup.migratePath}:</span>{' '}
                  <span className="font-mono text-xs">{migration.path}</span>
                  {migration.size ? <span className="ml-2 text-xs font-semibold text-gray-400">({migration.size})</span> : null}
                </p>
              </div>
            </div>
            <div>
              <LoadingButton onClick={() => setConfirmMigration(true)} loading={migrating} disabled={migrating}>
                <Download size={16} />
                {migrating ? es.backup.importing : es.backup.migrateButton}
              </LoadingButton>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-500 mt-0.5 shrink-0" />
            <div className="text-sm text-gray-700">{es.backup.migrateNotFound}</div>
          </div>
        )}

        {migrationResult ? (
          <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <p className="text-sm font-semibold text-gray-800 mb-2">{es.backup.migrateDone}</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-700">
              <div>
                <span className="text-gray-500">{es.backup.migrateAccount}:</span>{' '}
                <span className="font-semibold">{migrationResult.accountId}</span>
              </div>
              <div>
                <span className="text-gray-500">{es.backup.migrateIntegrity}:</span>{' '}
                <span className="font-semibold text-emerald-600">{migrationResult.integrity}</span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500">{es.backup.migrateBackup}:</span>{' '}
                <span className="font-mono text-xs">{migrationResult.backupPath}</span>
              </div>
            </div>
            {Object.keys(migrationResult.rows).length > 0 && (
              <>
                <p className="text-sm font-semibold text-gray-800 mt-3 mb-1">{es.backup.migrateRows}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                  {Object.entries(migrationResult.rows).map(([table, count]) => (
                    <div key={table} className="flex justify-between gap-2">
                      <span className="text-gray-500">{table}</span>
                      <span className="font-semibold text-gray-800">{count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : null}
      </Card>

      <Card title={es.backup.backupList}>
        {backups.length > 0 ? (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.backup.fileName}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.backup.backupDate}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.backup.backupSize}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.backup.actions}</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-800 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <Database size={14} className="text-gray-400" />
                        {b.fileName}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100 whitespace-nowrap">
                      {formatDateTime(b.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100">{b.size}</td>
                    <td className="px-4 py-3 border-b border-gray-100">
                      <span className={`tc-badge ${b.valid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                        {b.valid ? 'Válida' : 'Inválida'}
                      </span>
                    </td>
                    <td className="px-4 py-3 border-b border-gray-100">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmRestore(b.id)}
                          disabled={restoring === b.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors border-none cursor-pointer disabled:opacity-50"
                        >
                          {restoring === b.id ? <RefreshCw size={12} className="animate-spin" /> : <Download size={12} />}
                          {es.backup.restore}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(b.id)}
                          disabled={deleting === b.id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors border-none cursor-pointer disabled:opacity-50"
                        >
                          {deleting === b.id ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          {es.backup.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Database} title={es.backup.noBackups} />
        )}
      </Card>

      <ConfirmDialog
        isOpen={!!confirmRestore}
        onClose={() => setConfirmRestore(null)}
        onConfirm={() => confirmRestore && handleRestore(confirmRestore)}
        title={es.backup.restoreBackup}
        message={es.backup.restoreConfirm.replace('{fileName}', backups.find((b) => b.id === confirmRestore)?.fileName ?? '')}
        confirmLabel={es.backup.restore}
        variant="warning"
        loading={!!restoring}
      />

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title={es.backup.deleteBackup}
        message={es.backup.deleteConfirm.replace('{fileName}', backups.find((b) => b.id === confirmDelete)?.fileName ?? '')}
        confirmLabel={es.backup.delete}
        variant="danger"
        loading={!!deleting}
      />

      <ConfirmDialog
        isOpen={confirmMigration}
        onClose={() => setConfirmMigration(false)}
        onConfirm={handleMigrate}
        title={es.backup.migrateTitle}
        message={es.backup.migrateConfirm}
        confirmLabel={es.backup.migrateButton}
        variant="warning"
        loading={migrating}
      />
    </div>
  );
}
