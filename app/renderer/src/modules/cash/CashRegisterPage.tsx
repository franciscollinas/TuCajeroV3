import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useCallback, useEffect, useState } from 'react';
import {
  DollarSign, Lock, Unlock, Receipt, Plus, X,
  TrendingUp, History, Timer, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { trpc } from '../../trpc';
import { useAuth } from '../../shared/context/AuthContext';
import { formatCurrency, formatDateTime } from '../../shared/utils/formatters';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { DataTable } from '../../shared/components/DataTable';
import type { Column } from '../../shared/components/DataTable';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { LoadError } from '../../shared/components/LoadError';
import { Modal } from '../../shared/components/Modal';
import { useCloseCash } from '../../shared/hooks/useCloseCash';
import { EXPENSE_CONCEPTS, parseExpenseReason } from '../../shared/types/cash.types';
import type {
  CashRegister, CashClosureRow, CashExpense, CashSessionOverview, CashCloseSummary, ExpenseConcept,
} from '../../shared/types/cash.types';

const PAYMENT_ORDER = ['efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'credito'];
const PAYMENT_LABELS: Record<string, string> = {
  efectivo: 'Efectivo (neto)',
  transferencia: 'Transferencia',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  tarjeta: 'Tarjeta',
  credito: 'Crédito (fiado)',
};
const PAYMENT_COLORS: Record<string, { bg: string; text: string }> = {
  efectivo: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  tarjeta: { bg: 'bg-blue-50', text: 'text-blue-700' },
  nequi: { bg: 'bg-purple-50', text: 'text-purple-700' },
  daviplata: { bg: 'bg-cyan-50', text: 'text-cyan-700' },
  transferencia: { bg: 'bg-orange-50', text: 'text-orange-700' },
  credito: { bg: 'bg-rose-50', text: 'text-rose-700' },
};

export default function CashRegisterPage(): JSX.Element {
  const { user, currentBranch } = useAuth();

  const [session, setSession] = useState<CashRegister | null>(null);
  const [overview, setOverview] = useState<CashSessionOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cashLoading, setCashLoading] = useState(false);

  const [initialCash, setInitialCash] = useState('');
  const [finalCash, setFinalCash] = useState('');
  const [lastClosure, setLastClosure] = useState<CashCloseSummary | null>(null);

  const [todaySales, setTodaySales] = useState(0);
  const [expenses, setExpenses] = useState<CashExpense[]>([]);
  const [closures, setClosures] = useState<CashClosureRow[]>([]);

  const [sessionDuration, setSessionDuration] = useState('');
  const [isMultiDay, setIsMultiDay] = useState(false);

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseConcept, setExpenseConcept] = useState<ExpenseConcept | ''>('');
  const [expenseNote, setExpenseNote] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);

  const [showClosures, setShowClosures] = useState(false);
  const [exportingClosures, setExportingClosures] = useState(false);

  const [reconcileTarget, setReconcileTarget] = useState<CashClosureRow | null>(null);
  const [countedInput, setCountedInput] = useState('');
  const [reconcileNote, setReconcileNote] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const branchId = currentBranch?.id;
  const canReconcile = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR';
  const pendingClosures = closures.filter((c) => c.pendingReconciliation);

  const openReconcile = (row: CashClosureRow): void => {
    setReconcileTarget(row);
    setCountedInput('');
    setReconcileNote('');
    setReconcileError(null);
  };

  const handleReconcile = async (): Promise<void> => {
    if (!reconcileTarget) return;
    const counted = Math.round(Number(countedInput));
    if (countedInput.trim() === '' || !Number.isFinite(counted) || counted < 0) {
      setReconcileError('Escribe el efectivo que contaste (0 o más).');
      return;
    }
    setReconciling(true);
    setReconcileError(null);
    try {
      await trpc.cash.reconcile.mutate({ sessionId: reconcileTarget.id, countedCash: counted, note: reconcileNote.trim() || undefined });
      setReconcileTarget(null);
      const list = await trpc.cash.listClosures.query({ branchId });
      setClosures(list as CashClosureRow[]);
    } catch (err) {
      rendererLogger.error('CashRegisterPage', 'Error reconciling closure:', err);
      setReconcileError(err instanceof Error ? err.message : 'No se pudo conciliar el cierre.');
    } finally {
      setReconciling(false);
    }
  };

  // Datos de la sesión activa: resumen de la sesión, egresos, ventas del día y cierres.
  const loadSessionData = useCallback(
    async (active: CashRegister): Promise<void> => {
      if (!user) return;
      const [sessionOverview, expensesList, closuresList, salesTotal] = await Promise.all([
        trpc.cash.getSessionOverview.query({ sessionId: active.id }),
        trpc.cash.listExpenses.query({ sessionId: active.id }),
        trpc.cash.listClosures.query({ branchId }),
        trpc.cash.getTodaySalesTotal.query({ userId: user.id }),
      ]);
      setOverview(sessionOverview);
      setExpenses(expensesList as CashExpense[]);
      setClosures(closuresList as CashClosureRow[]);
      setTodaySales(Number(salesTotal ?? 0));
    },
    [user, branchId],
  );

  const refreshOverview = useCallback(
    async (sessionId: number): Promise<void> => {
      const [sessionOverview, expensesList] = await Promise.all([
        trpc.cash.getSessionOverview.query({ sessionId }),
        trpc.cash.listExpenses.query({ sessionId }),
      ]);
      setOverview(sessionOverview);
      setExpenses(expensesList as CashExpense[]);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        if (!user) return;
        setLoadError(null);
        const activeSession = await trpc.cash.getActive.query({ userId: user.id, branchId }) as CashRegister | null;
        if (cancelled) return;
        setSession(activeSession);

        if (activeSession) {
          await loadSessionData(activeSession);
          if (cancelled) return;
          const openedAt = new Date(activeSession.openedAt);
          const today = new Date();
          setIsMultiDay(
            openedAt.getDate() !== today.getDate() ||
            openedAt.getMonth() !== today.getMonth() ||
            openedAt.getFullYear() !== today.getFullYear(),
          );
        } else {
          const closuresList = await trpc.cash.listClosures.query({ branchId });
          if (cancelled) return;
          setClosures(closuresList as CashClosureRow[]);
        }
      } catch (err) {
        rendererLogger.error('CashRegisterPage', 'Error fetching cash data:', err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Error desconocido.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [user, branchId, loadSessionData, reloadKey]);

  // Session timer
  useEffect(() => {
    if (!session) { setSessionDuration(''); return; }
    const update = () => {
      const diff = Date.now() - new Date(session.openedAt).getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setSessionDuration(`${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [session]);

  const handleClosed = useCallback(
    (summary: CashCloseSummary): void => {
      setSession(null);
      setOverview(null);
      setExpenses([]);
      setFinalCash('');
      setLastClosure(summary);
      trpc.cash.listClosures.query({ branchId }).then((list) => setClosures(list as CashClosureRow[])).catch((err) => {
        rendererLogger.error('CashRegisterPage', 'Error refreshing closures:', err);
      });
    },
    [branchId],
  );

  const { requestClose, closeDialog } = useCloseCash(handleClosed);

  const handleOpenCash = async () => {
    if (!user) return;
    const amount = Number(initialCash);
    if (!amount || amount <= 0) return;
    setCashLoading(true);
    try {
      const result = await trpc.cash.open.mutate({ userId: user.id, initialCash: amount, branchId }) as CashRegister;
      setSession(result);
      setInitialCash('');
      setLastClosure(null);
      await loadSessionData(result);
    } catch (err) {
      rendererLogger.error('CashRegisterPage', 'Error opening cash:', err);
      alert(err instanceof Error ? err.message : 'No se pudo abrir la caja.');
    } finally {
      setCashLoading(false);
    }
  };

  const handleCloseCash = async () => {
    if (!session) return;
    const amount = Number(finalCash);
    if (!Number.isFinite(amount) || amount < 0 || finalCash === '') return;
    setCashLoading(true);
    try {
      await requestClose(session.id, amount);
    } catch (err) {
      rendererLogger.error('CashRegisterPage', 'Error closing cash:', err);
      alert(err instanceof Error ? err.message : 'No se pudo cerrar la caja.');
    } finally {
      setCashLoading(false);
    }
  };

  const handleExportClosures = async (format: 'csv' | 'xlsx') => {
    setExportingClosures(true);
    try {
      const result = await trpc.export.cashSessions.mutate({ format }) as { path: string };
      if (result.path && window.api?.openFile) {
        await window.api.openFile(result.path);
      }
    } catch (err) {
      rendererLogger.error('CashRegisterPage', 'Export error:', err);
    } finally {
      setExportingClosures(false);
    }
  };

  const resetExpenseForm = (): void => {
    setShowAddExpense(false);
    setExpenseConcept('');
    setExpenseNote('');
    setExpenseAmount('');
    setExpenseError(null);
  };

  const handleAddExpense = async () => {
    if (!session || !user || !expenseConcept) return;
    const amount = Number(expenseAmount);
    if (!amount || amount <= 0) return;
    if (expenseConcept === 'Otro' && !expenseNote.trim()) {
      setExpenseError('Describe el egreso cuando eliges «Otro».');
      return;
    }
    setExpenseLoading(true);
    setExpenseError(null);
    try {
      await trpc.cash.createExpense.mutate({
        sessionId: session.id,
        userId: user.id,
        amount,
        concept: expenseConcept,
        note: expenseNote.trim() || undefined,
      });
      resetExpenseForm();
      // Refresca también el esperado de la sesión.
      const active = await trpc.cash.getActive.query({ userId: user.id, branchId }) as CashRegister | null;
      if (active) setSession(active);
      await refreshOverview(session.id);
    } catch (err) {
      rendererLogger.error('CashRegisterPage', 'Error adding expense:', err);
      setExpenseError(err instanceof Error ? err.message : 'No se pudo registrar el egreso.');
    } finally {
      setExpenseLoading(false);
    }
  };

  const expectedCash = overview?.expectedCash ?? (session ? (session.expectedCash ?? session.initialCash) : 0);
  const expectedMismatch = overview !== null && overview.computedExpectedCash !== overview.expectedCash;

  const paymentTiles = overview
    ? PAYMENT_ORDER.filter((m) => m === 'efectivo' || (overview.payments[m] ?? 0) !== 0)
        .concat(Object.keys(overview.payments).filter((m) => !PAYMENT_ORDER.includes(m) && overview.payments[m] !== 0))
    : [];

  const expenseColumns: Column<CashExpense>[] = [
    {
      key: 'reason', header: 'Concepto',
      render: (row) => {
        const { concept, note } = parseExpenseReason(row.reason);
        return (
          <div>
            <span className="font-medium text-gray-800">{concept}</span>
            {note && <span className="block text-xs text-gray-500">{note}</span>}
          </div>
        );
      },
    },
    {
      key: 'amount', header: 'Monto',
      render: (row) => <span className="font-semibold text-red-600">{formatCurrency(row.amount)}</span>,
    },
    {
      key: 'createdAt', header: 'Fecha',
      render: (row) => <span className="text-gray-500">{formatDateTime(row.createdAt)}</span>,
    },
  ];

  const closureColumns: Column<CashClosureRow>[] = [
    {
      key: 'user', header: 'Usuario',
      render: (row) => row.user.fullName,
    },
    {
      key: 'initialCash', header: 'Inicial',
      render: (row) => formatCurrency(row.initialCash),
    },
    {
      key: 'finalCash', header: 'Contado',
      render: (row) => row.pendingReconciliation
        ? <StatusBadge status="warning" variant="warning" label="Cierre automático" />
        : row.finalCash != null
          ? <span>{formatCurrency(row.finalCash)}{row.autoClosed && <span className="ml-2 text-xs text-amber-600" title="Se cerró sola y el efectivo se contó después">conciliado</span>}</span>
          : '--',
    },
    {
      key: 'expectedCash', header: 'Esperado',
      render: (row) => row.expectedCash != null ? formatCurrency(row.expectedCash) : '--',
    },
    {
      key: 'difference', header: 'Diferencia',
      render: (row) => {
        if (row.difference == null) return row.pendingReconciliation ? <span className="text-xs text-gray-400">Sin conteo</span> : '--';
        const color = row.difference === 0 ? 'text-gray-500' : row.difference > 0 ? 'text-green-600' : 'text-red-600';
        return <span className={`font-semibold ${color}`}>{formatCurrency(row.difference)}</span>;
      },
    },
    {
      key: 'openedAt', header: 'Abierta',
      render: (row) => formatDateTime(row.openedAt),
    },
    {
      key: 'closedAt', header: 'Cerrada',
      render: (row) => row.closedAt ? formatDateTime(row.closedAt) : '--',
    },
    ...(canReconcile ? [{
      key: 'reconcile', header: '',
      render: (row: CashClosureRow) => row.pendingReconciliation
        ? <button type="button" onClick={() => openReconcile(row)} className="px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors">Conciliar</button>
        : null,
    }] : []),
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (loadError) {
    return <LoadError what="la caja" detail={loadError} onRetry={() => { setLoading(true); setReloadKey((k) => k + 1); }} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Gestión de Caja</h1>
        <p className="text-sm text-gray-500 mt-1">{es.cash.overview}</p>
      </div>

      {lastClosure && !session && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-semibold text-emerald-900">Caja cerrada</p>
              <p className="text-sm text-emerald-800">
                Esperado {formatCurrency(lastClosure.expectedCash)} · Contado {formatCurrency(lastClosure.finalCash)} ·{' '}
                {lastClosure.difference === 0 ? (
                  <strong>sin diferencia</strong>
                ) : (
                  <strong className={lastClosure.difference < 0 ? 'text-red-700' : 'text-amber-700'}>
                    diferencia {lastClosure.difference > 0 ? '+' : '-'}{formatCurrency(Math.abs(lastClosure.difference))}
                  </strong>
                )}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setLastClosure(null)} className="text-emerald-700 hover:text-emerald-900" aria-label="Cerrar aviso">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Current Session Status */}
          <Card
            title={es.cashSession.status}
            subtitle={session ? es.cash.opened : es.cashSession.isClosed}
            actions={
              session ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  <Unlock size={14} />
                  {es.cashSession.isOpen}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                  <Lock size={14} />
                  {es.cashSession.isClosed}
                </span>
              )
            }
          >
            {session ? (
              <div className="space-y-5">
                {/* Summary of THIS session */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Inicial</p>
                    <p className="text-xl font-bold text-gray-900">{formatCurrency(session.initialCash)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Efectivo esperado</p>
                    <p className="text-xl font-bold text-blue-700">{formatCurrency(expectedCash)}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Ventas de la sesión</p>
                    <p className="text-xl font-bold text-emerald-700">{formatCurrency(overview?.salesTotal ?? 0)}</p>
                    <p className="text-xs text-emerald-700/80 mt-0.5">{overview?.salesCount ?? 0} venta{overview?.salesCount === 1 ? '' : 's'}</p>
                  </div>
                </div>

                {overview && (
                  <p className="text-xs text-gray-500">
                    Inicial <strong className="text-gray-700">{formatCurrency(overview.initialCash)}</strong>
                    {' + '}efectivo cobrado <strong className="text-gray-700">{formatCurrency(overview.cashCollected)}</strong>
                    {' − '}egresos <strong className="text-gray-700">{formatCurrency(overview.expensesTotal)}</strong>
                    {' = '}<strong className="text-blue-700">{formatCurrency(overview.computedExpectedCash)}</strong>
                  </p>
                )}

                {expectedMismatch && overview && (
                  <div role="alert" className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                    <AlertTriangle size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-800">
                      El efectivo esperado registrado ({formatCurrency(overview.expectedCash)}) no coincide con el cálculo de esta pantalla ({formatCurrency(overview.computedExpectedCash)}). Revisa las ventas y los egresos antes de cerrar.
                    </p>
                  </div>
                )}

                <div className="text-xs text-gray-400 flex items-center gap-1">
                  <History size={12} />
                  Abierta: {formatDateTime(session.openedAt)}
                  {sessionDuration && (
                    <span className="ml-2 flex items-center gap-1 text-indigo-600 font-medium">
                      <Timer size={12} /> {sessionDuration}
                    </span>
                  )}
                </div>

                {isMultiDay && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                    <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">Caja abierta desde ayer</p>
                      <p className="text-xs text-amber-700">La sesión se inició en un día anterior. Verifica los montos al cierre.</p>
                    </div>
                  </div>
                )}

                {/* Collected in this session, by method */}
                {overview && paymentTiles.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
                      <DollarSign size={16} />
                      Cobrado en esta sesión
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {paymentTiles.map((method) => {
                        const c = PAYMENT_COLORS[method] ?? { bg: 'bg-gray-50', text: 'text-gray-700' };
                        return (
                          <div key={method} className={`${c.bg} rounded-xl p-3`}>
                            <p className="text-xs text-gray-500 font-medium mb-1">{PAYMENT_LABELS[method] ?? method}</p>
                            <p className={`text-base font-bold ${c.text} mt-1`}>{formatCurrency(overview.payments[method] ?? 0)}</p>
                            {method === 'credito' && <p className="text-[11px] text-gray-400 mt-0.5">No entra a la caja</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Expenses list */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                      <Receipt size={16} />
                      Egresos de la sesión
                      {overview && overview.expensesCount > 0 && (
                        <span className="text-xs font-normal text-gray-400">· {formatCurrency(overview.expensesTotal)}</span>
                      )}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowAddExpense(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                    >
                      <Plus size={14} />
                      Registrar egreso
                    </button>
                  </div>
                  {expenses.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No hay egresos registrados</p>
                  ) : (
                    <DataTable
                      columns={expenseColumns}
                      data={expenses}
                      keyExtractor={(row) => row.id}
                    />
                  )}
                </div>

                {/* Add expense form */}
                {showAddExpense && (
                  <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-gray-700">Nuevo egreso</h4>
                      <button type="button" onClick={resetExpenseForm} className="text-gray-400 hover:text-gray-600" aria-label="Cancelar egreso">
                        <X size={16} />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="expense-concept" className="block text-xs font-medium text-gray-600 mb-1">Concepto</label>
                        <select
                          id="expense-concept"
                          value={expenseConcept}
                          onChange={(e) => setExpenseConcept(e.target.value as ExpenseConcept | '')}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        >
                          <option value="">Selecciona un concepto…</option>
                          {EXPENSE_CONCEPTS.map((concept) => (
                            <option key={concept} value={concept}>{concept}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="expense-amount" className="block text-xs font-medium text-gray-600 mb-1">Monto</label>
                        <div className="relative">
                          <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            id="expense-amount"
                            type="number"
                            step="1"
                            min="0"
                            value={expenseAmount}
                            onChange={(e) => setExpenseAmount(e.target.value)}
                            placeholder="0"
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="expense-note" className="block text-xs font-medium text-gray-600 mb-1">
                        Detalle {expenseConcept === 'Otro' ? <span className="text-red-500">(obligatorio)</span> : <span className="text-gray-400">(opcional)</span>}
                      </label>
                      <input
                        id="expense-note"
                        type="text"
                        value={expenseNote}
                        maxLength={200}
                        onChange={(e) => setExpenseNote(e.target.value)}
                        placeholder={expenseConcept === 'Otro' ? 'Describe el egreso' : 'Ej.: factura de la luz'}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                    {expenseError && <p role="alert" className="text-sm font-medium text-red-600">{expenseError}</p>}
                    <LoadingButton
                      onClick={handleAddExpense}
                      loading={expenseLoading}
                      disabled={!expenseConcept || !expenseAmount || Number(expenseAmount) <= 0}
                      size="sm"
                    >
                      Registrar egreso
                    </LoadingButton>
                  </div>
                )}

                {/* Close session */}
                <div className="border-t border-gray-200 pt-4">
                  <p className="text-xs text-gray-500 mb-2">Cuenta el efectivo del cajón e ingrésalo para cerrar. Si no coincide con lo esperado, te pediremos confirmar.</p>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative">
                      <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={finalCash}
                        onChange={(e) => setFinalCash(e.target.value)}
                        placeholder="Efectivo contado"
                        aria-label="Efectivo contado"
                        className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-44"
                      />
                    </div>
                    <LoadingButton
                      onClick={handleCloseCash}
                      loading={cashLoading}
                      disabled={finalCash === ''}
                      variant="danger"
                    >
                      <Lock size={16} />
                      {es.cashSession.close}
                    </LoadingButton>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-500">{es.cash.openingHint}</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="relative">
                    <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={initialCash}
                      onChange={(e) => setInitialCash(e.target.value)}
                      placeholder={es.cashSession.openAmount}
                      className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-40"
                    />
                  </div>
                  <LoadingButton
                    onClick={handleOpenCash}
                    loading={cashLoading}
                    disabled={!initialCash || Number(initialCash) <= 0}
                  >
                    <Unlock size={16} />
                    {es.cashSession.open}
                  </LoadingButton>
                </div>
              </div>
            )}
          </Card>

          {/* Day context (all of the cashier's sessions today) */}
          {session && (
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
              <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                <TrendingUp size={20} className="text-gray-500" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Ventas de hoy en todas tus cajas</p>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(todaySales)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick actions */}
          {session && (
            <Card title="Acciones rápidas">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowAddExpense(true)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Plus size={16} className="text-red-500" />
                  Registrar egreso
                </button>
                <button
                  type="button"
                  onClick={() => setShowClosures(true)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <History size={16} className="text-indigo-500" />
                  Historial de cierres
                </button>
              </div>
            </Card>
          )}

          {/* Closures summary */}
          <Card title="Últimos cierres" subtitle="Historial de cortes de caja">
            {closures.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No hay cierres registrados</p>
            ) : (
              <div className="space-y-2">
                {pendingClosures.length > 0 && (
                  <div role="status" className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>
                      {pendingClosures.length === 1 ? '1 cierre automático sin contar' : `${pendingClosures.length} cierres automáticos sin contar`}.
                      {canReconcile ? ' Cuenta el efectivo y concílialo para saber si cuadra.' : ' Un administrador debe contar el efectivo.'}
                    </span>
                  </div>
                )}
                {closures.slice(0, 5).map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 p-2.5 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{c.user.fullName}</p>
                      <p className="text-xs text-gray-400">{formatDateTime(c.closedAt)}</p>
                    </div>
                    {c.pendingReconciliation ? (
                      <div className="text-right">
                        <StatusBadge status="warning" variant="warning" label="Cierre automático" />
                        <p className="text-xs text-gray-400 mt-1">Esperado {formatCurrency(c.expectedCash ?? c.initialCash)}</p>
                        {canReconcile && (
                          <button type="button" onClick={() => openReconcile(c)} className="mt-1 px-2.5 py-1 text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors">
                            Conciliar
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-900">{formatCurrency(c.finalCash ?? 0)}</p>
                        {c.autoClosed && <p className="text-xs text-amber-600">Cierre automático conciliado</p>}
                        {c.difference != null && (
                          <p className={`text-xs font-medium ${c.difference === 0 ? 'text-gray-400' : c.difference > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {c.difference > 0 ? '+' : ''}{formatCurrency(c.difference)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {closures.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowClosures(true)}
                    className="w-full text-center text-sm text-indigo-600 hover:text-indigo-700 font-medium pt-2"
                  >
                    Ver todos ({closures.length})
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {closeDialog}

      <Modal
        isOpen={reconcileTarget !== null}
        onClose={() => { if (!reconciling) setReconcileTarget(null); }}
        title="Conciliar cierre automático"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <LoadingButton variant="secondary" onClick={() => setReconcileTarget(null)} disabled={reconciling}>Cancelar</LoadingButton>
            <LoadingButton onClick={handleReconcile} loading={reconciling}>Guardar conteo</LoadingButton>
          </div>
        }
      >
        {reconcileTarget && (() => {
          const expected = reconcileTarget.expectedCash ?? reconcileTarget.initialCash;
          const counted = Math.round(Number(countedInput));
          const hasCount = countedInput.trim() !== '' && Number.isFinite(counted) && counted >= 0;
          const diff = counted - expected;
          return (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                La caja de <strong>{reconcileTarget.user.fullName}</strong> se cerró sola el {formatDateTime(reconcileTarget.closedAt)} por inactividad, sin contar el efectivo.
              </p>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg text-sm">
                <span className="text-gray-500">Efectivo esperado</span>
                <span className="font-bold text-gray-900">{formatCurrency(expected)}</span>
              </div>
              <div>
                <label htmlFor="reconcile-counted" className="block text-sm font-medium text-gray-700 mb-1">Efectivo contado</label>
                <input
                  id="reconcile-counted"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  className="tc-input"
                  value={countedInput}
                  onChange={(e) => setCountedInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleReconcile(); }}
                  placeholder="0"
                />
              </div>
              {hasCount && (
                <p className={`text-sm font-semibold ${diff === 0 ? 'text-gray-600' : diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {diff === 0 ? 'Cuadra exacto.' : diff > 0 ? `Sobran ${formatCurrency(diff)}.` : `Faltan ${formatCurrency(-diff)}.`}
                </p>
              )}
              <div>
                <label htmlFor="reconcile-note" className="block text-sm font-medium text-gray-700 mb-1">Nota (opcional)</label>
                <input
                  id="reconcile-note"
                  type="text"
                  maxLength={300}
                  className="tc-input"
                  value={reconcileNote}
                  onChange={(e) => setReconcileNote(e.target.value)}
                  placeholder="Ej: se contó al día siguiente"
                />
              </div>
              {reconcileError && <p role="alert" className="text-sm text-red-600">{reconcileError}</p>}
              <p className="text-xs text-gray-400">Queda guardado quién concilió y cuánto contó. Solo se puede hacer una vez.</p>
            </div>
          );
        })()}
      </Modal>

      {/* Closures History Modal */}
      {showClosures && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowClosures(false)}>
          <div
            className="bg-white rounded-xl max-w-4xl w-[90%] max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Historial de cierres de caja</h3>
                <p className="text-sm text-gray-500">Todos los cortes registrados en el sistema</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExportClosures('csv')}
                  disabled={exportingClosures}
                  className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => handleExportClosures('xlsx')}
                  disabled={exportingClosures}
                  className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                >
                  XLSX
                </button>
                <button
                  type="button"
                  onClick={() => setShowClosures(false)}
                  className="p-1 text-gray-400 hover:text-gray-600"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1">
              {closures.length === 0 ? (
                <p className="text-center text-gray-400 py-8">No hay cierres registrados</p>
              ) : (
                <DataTable
                  columns={closureColumns}
                  data={closures}
                  keyExtractor={(row) => row.id}
                />
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                type="button"
                onClick={() => setShowClosures(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
