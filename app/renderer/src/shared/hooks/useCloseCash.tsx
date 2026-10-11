import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { trpc } from '../../trpc';
import { formatCurrency } from '../utils/formatters';
import { Modal } from '../components/Modal';
import { LoadingButton } from '../components/LoadingButton';
import type { CashCloseSummary } from '../types/cash.types';

interface PendingClose {
  sessionId: number;
  counted: number;
  expected: number;
  difference: number;
}

/**
 * Flujo único de cierre de caja (página de Caja y tarjeta del Dashboard).
 *
 * Si el efectivo contado coincide con el esperado, cierra de inmediato. Si hay
 * diferencia, pide confirmación mostrando esperado, contado y diferencia, y deja
 * anotar un motivo opcional que queda en la auditoría. El esperado se vuelve a
 * pedir al servidor justo antes, por si cambió mientras se contaba.
 */
export function useCloseCash(onClosed: (summary: CashCloseSummary) => void): {
  requestClose: (sessionId: number, counted: number) => Promise<void>;
  closeDialog: ReactNode;
  closing: boolean;
} {
  const [pending, setPending] = useState<PendingClose | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (sessionId: number, counted: number, why?: string): Promise<void> => {
      setBusy(true);
      setError(null);
      try {
        const summary = await trpc.cash.close.mutate({ sessionId, finalCash: counted, reason: why?.trim() || undefined });
        setPending(null);
        setReason('');
        onClosed(summary);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo cerrar la caja.');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [onClosed],
  );

  const requestClose = useCallback(
    async (sessionId: number, counted: number): Promise<void> => {
      setError(null);
      const overview = await trpc.cash.getSessionOverview.query({ sessionId });
      const difference = counted - overview.expectedCash;
      if (difference === 0) {
        await execute(sessionId, counted);
        return;
      }
      setReason('');
      setPending({ sessionId, counted, expected: overview.expectedCash, difference });
    },
    [execute],
  );

  const cancel = (): void => {
    if (busy) return;
    setPending(null);
    setError(null);
  };

  const confirm = (): void => {
    if (!pending) return;
    // El error ya se muestra dentro del diálogo.
    execute(pending.sessionId, pending.counted, reason).catch(() => undefined);
  };

  const missing = pending !== null && pending.difference < 0;
  const closeDialog = (
    <Modal
      isOpen={pending !== null}
      onClose={cancel}
      title="El conteo no coincide con lo esperado"
      size="md"
      footer={
        <>
          <button type="button" onClick={cancel} disabled={busy} className="tc-btn tc-btn-secondary">
            Revisar conteo
          </button>
          <LoadingButton variant="danger" loading={busy} onClick={confirm}>
            Cerrar caja con esta diferencia
          </LoadingButton>
        </>
      }
    >
      {pending && (
        <div className="space-y-4">
          <div className={`flex items-start gap-2 rounded-xl border p-3 ${missing ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
            <AlertTriangle size={18} className={`mt-0.5 shrink-0 ${missing ? 'text-red-600' : 'text-amber-600'}`} />
            <p className={`text-sm font-medium ${missing ? 'text-red-800' : 'text-amber-800'}`}>
              {missing ? `Faltan ${formatCurrency(-pending.difference)} en la caja.` : `Sobran ${formatCurrency(pending.difference)} en la caja.`} Si cierras ahora, la diferencia quedará registrada.
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-gray-50 p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Esperado</dt>
              <dd className="mt-1 text-lg font-bold text-gray-900">{formatCurrency(pending.expected)}</dd>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Contado</dt>
              <dd className="mt-1 text-lg font-bold text-gray-900">{formatCurrency(pending.counted)}</dd>
            </div>
            <div className={`rounded-xl p-3 ${missing ? 'bg-red-50' : 'bg-amber-50'}`}>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Diferencia</dt>
              <dd className={`mt-1 text-lg font-bold ${missing ? 'text-red-700' : 'text-amber-700'}`}>
                {pending.difference > 0 ? '+' : '-'}{formatCurrency(Math.abs(pending.difference))}
              </dd>
            </div>
          </dl>

          <div>
            <label htmlFor="close-cash-reason" className="mb-1 block text-sm font-medium text-gray-700">
              Motivo de la diferencia <span className="font-normal text-gray-400">(opcional)</span>
            </label>
            <textarea
              id="close-cash-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Ej.: faltó un billete de $2.000 en el cambio"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  );

  return { requestClose, closeDialog, closing: busy };
}
