import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, AlertTriangle, Package, ShoppingCart, Calendar,
  Lock, Unlock, BarChart3, PieChart, List, ChevronRight,
  DollarSign, Clock, Award,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart as RePieChart, Pie, Cell, Legend,
  BarChart, Bar,
} from 'recharts';
import { trpc } from '../../trpc';
import { useAuth } from '../../shared/context/AuthContext';
import { useAlertStore } from '../../shared/store/alert.store';
import { useCashStore } from '../../shared/store/cash.store';
import { formatCurrency, formatDateTime } from '../../shared/utils/formatters';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { EmptyState } from '../../shared/components/EmptyState';
import type { DashboardSummary } from '../../shared/types/sales.types';

const PIE_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  credito: 'Crédito',
};

export default function DashboardPage(): JSX.Element {
  const { user, currentBranch } = useAuth();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [cashLoading, setCashLoading] = useState(false);
  const [initialCash, setInitialCash] = useState('');
  const [finalCash, setFinalCash] = useState('');
  const [showCloseInput, setShowCloseInput] = useState(false);
  const [dashboardPeriod, setDashboardPeriod] = useState<'week' | 'month'>('month');

  const { session: activeCash, fetchSession, fetchTodayTotals } = useCashStore();
  const { fetchAlerts } = useAlertStore();

  const fetchTimer = useRef<ReturnType<typeof setInterval>>();

  const initials = user
    ? user.fullName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const fetchData = useCallback(async () => {
    if (!user) return;
    const branchId = currentBranch?.id;
    try {
      const [summaryData] = await Promise.all([
        trpc.sales.getDashboardSummary.query(branchId ? { branchId } : undefined),
        fetchSession(user.id, branchId),
        fetchAlerts(branchId),
      ]);
      setSummary(summaryData as DashboardSummary);
    } catch (err) {
      rendererLogger.error('DashboardPage', 'Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [user, currentBranch, fetchSession, fetchAlerts]);

  useEffect(() => {
    fetchData();
    fetchTimer.current = setInterval(fetchData, 30000);
    return () => {
      if (fetchTimer.current) clearInterval(fetchTimer.current);
    };
  }, [fetchData]);

  const handleOpenCash = useCallback(async () => {
    if (!user) return;
    const amount = Number(initialCash);
    if (!amount || amount <= 0) return;
    setCashLoading(true);
    try {
      await useCashStore.getState().openCash(user.id, amount, currentBranch?.id);
      await fetchTodayTotals(user.id);
      setInitialCash('');
    } catch (err) {
      rendererLogger.error('DashboardPage', 'Error opening cash:', err);
    } finally {
      setCashLoading(false);
    }
  }, [initialCash, user, currentBranch, fetchTodayTotals]);

  const handleCloseCash = useCallback(async () => {
    if (!activeCash) return;
    if (!user) return;
    const amount = Number(finalCash);
    if (!amount || amount < 0) return;
    setCashLoading(true);
    try {
      await useCashStore.getState().closeCash(activeCash.id, amount, user.id);
      setFinalCash('');
      setShowCloseInput(false);
    } catch (err) {
      rendererLogger.error('DashboardPage', 'Error closing cash:', err);
    } finally {
      setCashLoading(false);
    }
  }, [activeCash, finalCash, user]);

  const { stockAlerts, expiryAlerts } = useAlertStore();
  const stockCritical = stockAlerts?.critical.length ?? 0;
  const stockWarning = stockAlerts?.warning.length ?? 0;
  const expiredCount = expiryAlerts?.expired.length ?? 0;
  const expiringCount = expiryAlerts?.expiringSoon.length ?? 0;
  const stockAlertsCount = stockCritical + stockWarning;
  const expiryAlertsCount = expiredCount + expiringCount;
  const totalAlerts = stockAlertsCount + expiryAlertsCount;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size={40} />
      </div>
    );
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const activeChart = dashboardPeriod === 'week' ? summary?.weeklyChart : summary?.monthlyChart;

  return (
    <div className="space-y-6">
      {/* ── Welcome Header ── */}
      <div className="relative overflow-hidden rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #3641f5, #2a31d8, #1e24b5)' }}>
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24 pointer-events-none" />
        <div className="relative z-10 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-xl font-bold select-none">
              {initials}
            </div>
            <div>
              <h1 className="tc-display text-2xl font-bold">
                {es.dashboard.welcome}, {user?.fullName ?? ''}
              </h1>
              <p className="text-indigo-200 flex items-center gap-1.5 mt-1">
                <Calendar size={14} />
                {dateStr}
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => navigate('/sales')} className="inline-flex items-center gap-2 px-4 py-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-lg text-sm font-medium transition-colors">
              <ShoppingCart size={16} />
              {es.sales.posTitle}
            </button>
            <button onClick={() => navigate('/inventory')} className="inline-flex items-center gap-2 px-4 py-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-lg text-sm font-medium transition-colors">
              <Package size={16} />
              {es.inventory.title}
            </button>
          </div>
        </div>
      </div>

      {/* ── Metric Cards ── */}
      <div className="tc-grid-4">
        <div className="tc-metric">
          <div className="flex items-center justify-between mb-3">
            <div className="tc-metric-icon tc-metric-icon--green">
              <TrendingUp size={24} />
            </div>
            <ChevronRight size={16} className="text-gray-300" />
          </div>
          <p className="tc-metric-label">{es.dashboard.todaySales}</p>
          <p className="tc-metric-value">
            {summary ? formatCurrency(summary.today.totalMonto) : '--'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {summary?.today.totalVendidos ?? 0} {es.reports.items}
          </p>
        </div>

        <div className="tc-metric">
          <div className="flex items-center justify-between mb-3">
            <div className="tc-metric-icon tc-metric-icon--indigo">
              <DollarSign size={24} />
            </div>
            <ChevronRight size={16} className="text-gray-300" />
          </div>
          <p className="tc-metric-label">Mes actual</p>
          <p className="tc-metric-value">
            {summary ? formatCurrency(summary.monthToDate.totalIngresos) : '--'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {summary?.monthToDate.totalVentas ?? 0} ventas
          </p>
        </div>

        <div className="tc-metric">
          <div className="flex items-center justify-between mb-3">
            <div className={`tc-metric-icon ${totalAlerts > 0 ? 'tc-metric-icon--amber' : 'tc-metric-icon--slate'}`}>
              <AlertTriangle size={24} />
            </div>
            <ChevronRight size={16} className="text-gray-300" />
          </div>
          <p className="tc-metric-label">{es.dashboard.activeAlerts}</p>
          <p className="tc-metric-value">{totalAlerts}</p>
          <div className="flex gap-3 mt-1.5 text-sm">
            <span className="text-amber-600 font-medium">{es.dashboard.lowStockAlert}: {stockAlertsCount}</span>
            <span className="text-red-600 font-medium">{es.dashboard.expiryAlert}: {expiryAlertsCount}</span>
          </div>
        </div>

        <div className="tc-metric">
          <div className="flex items-center justify-between mb-3">
            <div className={`tc-metric-icon ${activeCash ? 'tc-metric-icon--green' : 'tc-metric-icon--slate'}`}>
              {activeCash ? <Unlock size={24} /> : <Lock size={24} />}
            </div>
          </div>
          <p className="tc-metric-label">{es.dashboard.cashControl}</p>
          <div className="mt-1">
            {activeCash ? (
              <>
                <span className="tc-badge" style={{ background: '#ecfdf5', color: '#067647' }}>
                  <Unlock size={12} />
                  {es.cashSession.isOpen}
                </span>
                <p className="text-sm text-gray-400 mt-1">
                  {es.cash.finalCash}: {formatCurrency(activeCash.initialCash)}
                </p>
              </>
            ) : (
              <span className="tc-badge" style={{ background: '#f2f4f7', color: '#475467' }}>
                <Lock size={12} />
                {es.dashboard.noSession}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Cash Session Control ── */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 m-0">{es.dashboard.cashControl}</h3>
            <p className="text-sm text-gray-500 mt-1 mb-0">{es.dashboard.fromHere}</p>
          </div>
        </div>
        {activeCash ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                  <Unlock size={16} className="text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{es.dashboard.sessionActive}</p>
                  <p className="text-sm font-semibold text-gray-800">{formatCurrency(activeCash.initialCash)}</p>
                </div>
              </div>
              <div className="text-xs text-gray-400">
                <Clock size={12} className="inline mr-1" />
                {formatDateTime(activeCash.openedAt)}
              </div>
            </div>
            {showCloseInput ? (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative">
                  <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="number" step="0.01" min="0" value={finalCash} onChange={(e) => setFinalCash(e.target.value)} placeholder={es.cash.finalCash} className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-40" />
                </div>
                <button onClick={handleCloseCash} disabled={cashLoading || !finalCash} className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-sm font-medium rounded-lg transition-colors">
                  {cashLoading ? <LoadingSpinner size={16} /> : <Lock size={16} />}
                  {es.cashSession.close}
                </button>
                <button onClick={() => { setShowCloseInput(false); setFinalCash(''); }} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
                  {es.common.cancel}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowCloseInput(true)} className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors">
                <Lock size={16} />
                {es.cashSession.close}
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="number" step="0.01" min="0" value={initialCash} onChange={(e) => setInitialCash(e.target.value)} placeholder={es.cashSession.openAmount} className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-40" />
            </div>
            <button onClick={handleOpenCash} disabled={cashLoading || !initialCash} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg transition-colors">
              {cashLoading ? <LoadingSpinner size={16} /> : <Unlock size={16} />}
              {es.cashSession.open}
            </button>
          </div>
        )}
      </Card>

      {/* ── Charts Row 1 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales Trend */}
        <Card title={dashboardPeriod === 'week' ? 'Tendencia semanal' : 'Tendencia 30 días'} className="lg:col-span-2">
          <div className="flex gap-2 mb-4">
            <button onClick={() => setDashboardPeriod('week')} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${dashboardPeriod === 'week' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>7 días</button>
            <button onClick={() => setDashboardPeriod('month')} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${dashboardPeriod === 'month' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>30 días</button>
          </div>
          {activeChart && activeChart.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeChart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} formatter={(value: number, name: string) => {
                    if (name === 'ingresos') return [formatCurrency(value), 'Ingresos'];
                    return [value, 'Ventas'];
                  }} />
                  <Line type="monotone" dataKey="ventas" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: '#6366f1' }} name="ventas" />
                  <Line type="monotone" dataKey="ingresos" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} name="ingresos" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={BarChart3} title={es.common.noResults} className="py-8" />
          )}
        </Card>

        {/* Payment Methods */}
        <Card title="Métodos de pago">
          {summary?.paymentMethods && summary.paymentMethods.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie data={summary.paymentMethods} cx="50%" cy="50%" innerRadius={40} outerRadius={80} paddingAngle={3} dataKey="total" nameKey="label">
                    {summary.paymentMethods.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} formatter={(value: number) => [formatCurrency(value), 'Total']} />
                  <Legend verticalAlign="bottom" height={36} formatter={(value: string) => <span className="text-sm text-gray-600">{value}</span>} />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={PieChart} title={es.common.noResults} className="py-8" />
          )}
        </Card>
      </div>

      {/* ── Charts Row 2 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Products */}
        <Card title="Productos más vendidos">
          {summary?.topProducts && summary.topProducts.length > 0 ? (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Producto</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Cant</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.topProducts.map((p, i) => (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 border-b border-gray-100">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{p.name}</p>
                            <p className="text-xs text-gray-400 font-mono">{p.code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100 text-right">{p.quantity}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100 text-right">{formatCurrency(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Award} title={es.common.noResults} className="py-8" />
          )}
        </Card>

        {/* Top Categories */}
        <Card title={es.inventory.category}>
          {summary?.topCategories && summary.topCategories.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie data={summary.topCategories} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={3} dataKey="value" nameKey="name">
                    {summary.topCategories.map((_, i) => (
                      <Cell key={i} fill={summary.topCategories[i]?.color ?? PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} formatter={(value: number) => [value, 'Productos']} />
                  <Legend verticalAlign="bottom" height={36} formatter={(value: string) => <span className="text-sm text-gray-600">{value}</span>} />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={PieChart} title={es.common.noResults} className="py-8" />
          )}
        </Card>
      </div>

      {/* ── Sales by Payment Method (Bar) ── */}
      {summary?.paymentMethods && summary.paymentMethods.length > 0 && (
        <Card title="Ingresos por método de pago">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.paymentMethods} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} formatter={(value: number) => [formatCurrency(value), 'Total']} />
                <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} name="total" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ── Recent Sales Table ── */}
      <Card title={es.dashboard.recentSales}>
        {summary?.recentSales && summary.recentSales.length > 0 ? (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.sales.saleNumber}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.audit.date}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Cliente</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.sales.itemsCount}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.sales.totalLabel}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.sales.payment}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.sales.statusLabel}</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentSales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-indigo-600 border-b border-gray-100 whitespace-nowrap">{sale.saleNumber}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100 whitespace-nowrap">{formatDateTime(sale.createdAt)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100">{sale.customer?.name ?? '\u2014'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100">
                      <span className="inline-flex items-center gap-1"><Package size={13} className="text-gray-400" />{sale.items.reduce((sum, i) => sum + i.quantity, 0)}</span>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100 whitespace-nowrap">{formatCurrency(sale.total)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100">
                      <div className="flex gap-1 flex-wrap">
                        {sale.payments.map((p) => (
                          <StatusBadge key={p.id} status={p.method} label={PAYMENT_LABELS[p.method] ?? p.method} />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 border-b border-gray-100"><StatusBadge status={sale.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={List} title={es.sales.noSalesYet} className="py-8" />
        )}
      </Card>
    </div>
  );
}
