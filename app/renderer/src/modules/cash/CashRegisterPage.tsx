import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useState, useEffect } from 'react';
import {
  DollarSign, Lock, Unlock, Receipt, Plus, X,
  TrendingUp, History, Wallet, PiggyBank, Timer, AlertTriangle,
} from 'lucide-react';
import { trpc } from '../../trpc';
import { useAuth } from '../../shared/context/AuthContext';
import { formatCurrency, formatDateTime } from '../../shared/utils/formatters';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { DataTable } from '../../shared/components/DataTable';
import type { Column } from '../../shared/components/DataTable';
import type { CashRegister, CashClosureRow, CashExpense } from '../../shared/types/cash.types';

export default function CashRegisterPage(): JSX.Element {
  const { user, currentBranch } = useAuth();

  const [session, setSession] = useState<CashRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [cashLoading, setCashLoading] = useState(false);

  const [initialCash, setInitialCash] = useState('');
  const [finalCash, setFinalCash] = useState('');

  const [todaySales, setTodaySales] = useState(0);
  const [todayExpenses, setTodayExpenses] = useState(0);
  const [expenses, setExpenses] = useState<CashExpense[]>([]);
  const [closures, setClosures] = useState<CashClosureRow[]>([]);

  const [paymentsByMethod, setPaymentsByMethod] = useState<Record<string, number>>({});
  const [sessionDuration, setSessionDuration] = useState('');
  const [isMultiDay, setIsMultiDay] = useState(false);

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseReason, setExpenseReason] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseLoading, setExpenseLoading] = useState(false);

  const [showClosures, setShowClosures] = useState(false);
  const [exportingClosures, setExportingClosures] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        if (!user) return;
        const branchId = currentBranch?.id;
        const activeSession = await trpc.cash.getActive.query({ userId: user.id, branchId }) as CashRegister | null;
        if (cancelled) return;
        setSession(activeSession);

        if (activeSession) {
          const [salesTotal, expensesTotal, expensesList, closuresList, payments] = await Promise.all([
            trpc.cash.getTodaySalesTotal.query({ userId: user.id }),
            trpc.cash.getTodayExpenses.query({ userId: user.id }),
            trpc.cash.listExpenses.query({ sessionId: activeSession.id }),
            trpc.cash.listClosures.query({ branchId }),
            trpc.cash.getTodayPaymentsByMethod.query({ userId: user.id }),
          ]);
          if (cancelled) return;
          setTodaySales(Number(salesTotal ?? 0));
          setTodayExpenses(Number(expensesTotal ?? 0));
          setExpenses(expensesList as CashExpense[]);
          setClosures(closuresList as CashClosureRow[]);
          setPaymentsByMethod(payments as Record<string, number>);

          // Multi-day check
          const openedAt = new Date(activeSession.openedAt);
          const today = new Date();
          setIsMultiDay(
            openedAt.getDate() !== today.getDate() ||
            openedAt.getMonth() !== today.getMonth() ||
            openedAt.getFullYear() !== today.getFullYear()
          );
        } else {
          const closuresList = await trpc.cash.listClosures.query({ branchId });
          if (cancelled) return;
          setClosures(closuresList as CashClosureRow[]);
        }
      } catch (err) {
        rendererLogger.error('CashRegisterPage', 'Error fetching cash data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [user, currentBranch]);

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

  const handleOpenCash = async () => {
    if (!user) return;
    const amount = Number(initialCash);
    if (!amount || amount <= 0) return;
    setCashLoading(true);
    try {
      const result = await trpc.cash.open.mutate({ userId: user.id, initialCash: amount, branchId: currentBranch?.id }) as CashRegister;
      setSession(result);
      setInitialCash('');
      const [salesTotal, expensesTotal, expensesList, closuresList, payments] = await Promise.all([
        trpc.cash.getTodaySalesTotal.query({ userId: user.id }),
        trpc.cash.getTodayExpenses.query({ userId: user.id }),
        trpc.cash.listExpenses.query({ sessionId: result.id }),
        trpc.cash.listClosures.query({ branchId: currentBranch?.id }),
        trpc.cash.getTodayPaymentsByMethod.query({ userId: user.id }),
      ]);
      setTodaySales(Number(salesTotal ?? 0));
      setTodayExpenses(Number(expensesTotal ?? 0));
      setExpenses(expensesList as CashExpense[]);
      setClosures(closuresList as CashClosureRow[]);
      setPaymentsByMethod(payments as Record<string, number>);
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
    if (amount < 0) return;
    setCashLoading(true);
    try {
      const expectedCash = session.expectedCash ?? session.initialCash;
      await trpc.cash.close.mutate({ sessionId: session.id, finalCash: amount, expectedCash });
      setSession(null);
      setFinalCash('');
      const closuresList = await trpc.cash.listClosures.query({ branchId: currentBranch?.id });
      setClosures(closuresList as CashClosureRow[]);
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

  const handleAddExpense = async () => {
    if (!session || !expenseReason.trim() || !expenseAmount) return;
    if (!user) return;
    const amount = Number(expenseAmount);
    if (!amount || amount <= 0) return;
    setExpenseLoading(true);
    try {
      await trpc.cash.createExpense.mutate({
        sessionId: session.id,
        userId: user.id,
        reason: expenseReason.trim(),
        amount,
      });
      setExpenseReason('');
      setExpenseAmount('');
      setShowAddExpense(false);
      const [expensesList, expensesTotal] = await Promise.all([
        trpc.cash.listExpenses.query({ sessionId: session.id }),
        trpc.cash.getTodayExpenses.query({ userId: user.id }),
      ]);
      setExpenses(expensesList as CashExpense[]);
      setTodayExpenses(Number(expensesTotal ?? 0));
    } catch (err) {
      rendererLogger.error('CashRegisterPage', 'Error adding expense:', err);
    } finally {
      setExpenseLoading(false);
    }
  };

  const expectedCash = session ? (session.expectedCash ?? session.initialCash) : 0;

  const expenseColumns: Column<CashExpense>[] = [
    { key: 'reason', header: 'Razón' },
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
      key: 'initialCash', header: 'Apertura',
      render: (row) => formatCurrency(row.initialCash),
    },
    {
      key: 'finalCash', header: 'Cierre',
      render: (row) => row.finalCash != null ? formatCurrency(row.finalCash) : '--',
    },
    {
      key: 'expectedCash', header: 'Esperado',
      render: (row) => row.expectedCash != null ? formatCurrency(row.expectedCash) : '--',
    },
    {
      key: 'difference', header: 'Diferencia',
      render: (row) => {
        if (row.difference == null) return '--';
        const color = row.difference >= 0 ? 'text-green-600' : 'text-red-600';
        return <span className={`font-semibold ${color}`}>{formatCurrency(row.difference)}</span>;
      },
    },
    {
      key: 'openedAt', header: 'Apertura',
      render: (row) => formatDateTime(row.openedAt),
    },
    {
      key: 'closedAt', header: 'Cierre',
      render: (row) => row.closedAt ? formatDateTime(row.closedAt) : '--',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Gestión de Caja</h1>
        <p className="text-sm text-gray-500 mt-1">{es.cash.overview}</p>
      </div>

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
                {/* Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Inicial</p>
                    <p className="text-xl font-bold text-gray-900">{formatCurrency(session.initialCash)}</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Esperado</p>
                    <p className="text-xl font-bold text-blue-700">{formatCurrency(expectedCash)}</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Actual</p>
                    <p className="text-xl font-bold text-green-700">{formatCurrency(expectedCash)}</p>
                  </div>
                </div>

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

                {/* Today's totals */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl">
                    <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <TrendingUp size={20} className="text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Ventas hoy</p>
                      <p className="text-lg font-bold text-emerald-700">{formatCurrency(todaySales)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-red-50 rounded-xl">
                    <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                      <Receipt size={20} className="text-red-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Gastos hoy</p>
                      <p className="text-lg font-bold text-red-700">{formatCurrency(todayExpenses)}</p>
                    </div>
                  </div>
                </div>

                {/* Payment method breakdown */}
                {Object.keys(paymentsByMethod).length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-2 mb-3">
                      <DollarSign size={16} />
                      Desglose de pagos
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(paymentsByMethod).map(([method, amount]) => {
                        const colors: Record<string, { bg: string; text: string }> = {
                          efectivo: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
                          tarjeta: { bg: 'bg-blue-50', text: 'text-blue-700' },
                          nequi: { bg: 'bg-purple-50', text: 'text-purple-700' },
                          daviplata: { bg: 'bg-cyan-50', text: 'text-cyan-700' },
                          transferencia: { bg: 'bg-orange-50', text: 'text-orange-700' },
                          credito: { bg: 'bg-rose-50', text: 'text-rose-700' },
                        };
                        const c = colors[method] ?? { bg: 'bg-gray-50', text: 'text-gray-700' };
                        return (
                          <div key={method} className={`${c.bg} rounded-xl p-3`}>
                            <p className="text-xs text-gray-500 font-medium capitalize mb-1">{method}</p>
                            <p className={`text-base font-bold ${c.text} mt-1`}>
                              {formatCurrency(amount)}
                            </p>
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
                      Gastos de la sesión
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowAddExpense(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                    >
                      <Plus size={14} />
                      Agregar gasto
                    </button>
                  </div>
                  {expenses.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No hay gastos registrados</p>
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
                      <h4 className="text-sm font-semibold text-gray-700">Nuevo gasto</h4>
                      <button
                        type="button"
                        onClick={() => { setShowAddExpense(false); setExpenseReason(''); setExpenseAmount(''); }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={expenseReason}
                      onChange={(e) => setExpenseReason(e.target.value)}
                      placeholder="Razón del gasto"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <div className="relative">
                      <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={expenseAmount}
                        onChange={(e) => setExpenseAmount(e.target.value)}
                        placeholder="Monto"
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                    <LoadingButton
                      onClick={handleAddExpense}
                      loading={expenseLoading}
                      disabled={!expenseReason.trim() || !expenseAmount}
                      size="sm"
                    >
                      Registrar gasto
                    </LoadingButton>
                  </div>
                )}

                {/* Close session */}
                <div className="border-t border-gray-200 pt-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative">
                      <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={finalCash}
                        onChange={(e) => setFinalCash(e.target.value)}
                        placeholder={es.cash.finalCash}
                        className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-40"
                      />
                    </div>
                    <LoadingButton
                      onClick={handleCloseCash}
                      loading={cashLoading}
                      disabled={!finalCash}
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
                      step="0.01"
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

          {/* Today's summary when session is active */}
          {session && (
            <Card title="Resumen del día">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <TrendingUp size={20} className="text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Ventas del día</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(todaySales)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                    <Receipt size={20} className="text-red-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Gastos del día</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(todayExpenses)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <Wallet size={20} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Neto esperado</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(expectedCash)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <PiggyBank size={20} className="text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Efectivo en caja</p>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(expectedCash)}</p>
                  </div>
                </div>
              </div>
            </Card>
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
                  Registrar gasto
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
                {closures.slice(0, 5).map((c) => (
                  <div key={c.id} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{c.user.fullName}</p>
                      <p className="text-xs text-gray-400">{formatDateTime(c.closedAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{formatCurrency(c.finalCash ?? 0)}</p>
                      {c.difference != null && (
                        <p className={`text-xs font-medium ${c.difference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {c.difference >= 0 ? '+' : ''}{formatCurrency(c.difference)}
                        </p>
                      )}
                    </div>
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
