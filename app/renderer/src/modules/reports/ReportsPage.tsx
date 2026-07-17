import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useState, useEffect } from 'react';
import {
  BarChart3, TrendingUp, DollarSign, Package, Percent,
  ShoppingCart, Download, FileSpreadsheet, AlertTriangle,
  Calendar, Clock, ChevronRight, CreditCard,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Cell,
} from 'recharts';
import { trpc } from '../../trpc';
import { formatCurrency, formatDate, formatDateTime } from '../../shared/utils/formatters';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { EmptyState } from '../../shared/components/EmptyState';
import type { DashboardSummary } from '../../shared/types/sales.types';
import type { StockAlerts, ExpiryAlerts, NoRotationProduct } from '../../shared/types/inventory.types';
import type { CashClosureRow } from '../../shared/types/cash.types';

type ReportTab = 'general' | 'ventas' | 'inventario' | 'caja' | 'auditoria';

interface AuditEntry {
  id: number;
  date: string;
  user: string;
  action: string;
  entity: string;
  details: string;
}

export default function ReportsPage(): JSX.Element {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const [startDate, setStartDate] = useState(firstDay.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const [activeTab, setActiveTab] = useState<ReportTab>('general');

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [stockData, setStockData] = useState<StockAlerts | null>(null);
  const [expiryData, setExpiryData] = useState<ExpiryAlerts | null>(null);
  const [closures, setClosures] = useState<CashClosureRow[]>([]);
  const [auditRecords, setAuditRecords] = useState<AuditEntry[]>([]);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [noRotation, setNoRotation] = useState<NoRotationProduct[]>([]);
  const [prevRevenue, setPrevRevenue] = useState(0);
  const [prevSales, setPrevSales] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const [summaryData, stockAlerts, expiryAlerts, closuresData, inventoryData, auditData, noRotationData] = await Promise.all([
          trpc.sales.getDashboardSummary.query().catch(() => null),
          trpc.inventory.getStockAlerts.query().catch(() => null),
          trpc.inventory.getExpiryAlerts.query().catch(() => null),
          trpc.cash.listClosures.query().catch(() => []),
          trpc.inventory.getAll.query({}).catch(() => null),
          trpc.audit.list.query({ limit: 20, startDate, endDate }).catch(() => []),
          trpc.inventory.getNoRotation.query().catch(() => []),
        ]);
        if (cancelled) return;
        setSummary(summaryData as DashboardSummary | null);
        setStockData(stockAlerts as StockAlerts | null);
        setExpiryData(expiryAlerts as ExpiryAlerts | null);
        setClosures(closuresData as CashClosureRow[]);
        setAuditRecords(auditData as AuditEntry[]);
        if (inventoryData) {
          const data = inventoryData as { products: Array<{ stock: number; cost: number }> };
          const totalValue = data.products?.reduce((sum, p) => sum + (p.stock * p.cost), 0) ?? 0;
          setInventoryValue(totalValue);
        }
        setNoRotation(noRotationData as NoRotationProduct[]);

        // Previous period comparison
        const periodMs = new Date(endDate).getTime() - new Date(startDate).getTime();
        const prevStart = new Date(new Date(startDate).getTime() - periodMs).toISOString().split('T')[0];
        const prevEnd = new Date(new Date(startDate).getTime()).toISOString().split('T')[0];
        try {
          const prevSalesData = await trpc.sales.getByDateRange.query({ startDate: prevStart, endDate: prevEnd });
          const prevSalesArr = prevSalesData as Array<{ total: number }>;
          const totalPrevRevenue = prevSalesArr.reduce((s, x) => s + Number(x.total ?? 0), 0);
          const totalPrevCount = prevSalesArr.length;
          setPrevRevenue(totalPrevRevenue);
          setPrevSales(totalPrevCount);
        } catch {
          // silent
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  const totalSales = summary?.today.totalVendidos ?? 0;
  const netRevenue = summary?.today.totalMonto ?? 0;
  const monthRevenue = summary?.monthToDate.totalIngresos ?? 0;
  const estimatedProfit = summary?.monthToDate.totalProfit ?? 0;
  const profitMargin = netRevenue > 0 ? (estimatedProfit / monthRevenue) * 100 : 0;
  const avgTicket = totalSales > 0 ? netRevenue / totalSales : 0;

  const stockAlertsTotal = (stockData?.critical.length ?? 0) + (stockData?.warning.length ?? 0);
  const expiryAlertsTotal = (expiryData?.expired.length ?? 0) + (expiryData?.expiringSoon.length ?? 0);

  // Compute sales by product from monthly chart
  const salesData = summary?.monthlyChart ?? [];
  const totalSalesInPeriod = salesData.reduce((sum, d) => sum + d.ventas, 0);
  const totalRevenueInPeriod = salesData.reduce((sum, d) => sum + d.ingresos, 0);

  const handleExport = async (format: 'csv' | 'xlsx') => {
    setExporting(format);
    try {
      const result = await trpc.export.sales.mutate({ dateFrom: startDate, dateTo: endDate });
      const { path } = result as { path: string };
      if (path && window.api?.openFile) {
        await window.api.openFile(path);
      }
    } catch (err) {
      rendererLogger.error('ReportsPage', 'Export error:', err);
      alert('Error al exportar');
    } finally {
      setExporting(null);
    }
  };

  const tabs: { id: ReportTab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <BarChart3 size={15} /> },
    { id: 'ventas', label: 'Ventas', icon: <ShoppingCart size={15} /> },
    { id: 'inventario', label: 'Inventario', icon: <Package size={15} /> },
    { id: 'caja', label: 'Caja', icon: <CreditCard size={15} /> },
    { id: 'auditoria', label: 'Auditoría', icon: <Clock size={15} /> },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <BarChart3 size={16} />
            <span>{es.reports.title}</span>
            <ChevronRight size={14} />
            <span className="text-indigo-600 font-semibold">{es.reports.subtitle}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{es.reports.title}</h1>
          <p className="text-sm text-gray-500">{es.reports.subtitle}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-semibold disabled:opacity-50 border-none cursor-pointer">
            {exporting === 'csv' ? <LoadingSpinner size={16} /> : <FileSpreadsheet size={16} />}
            CSV
          </button>
          <button onClick={() => handleExport('xlsx')} disabled={!!exporting} className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-semibold disabled:opacity-50 border-none cursor-pointer">
            {exporting === 'xlsx' ? <LoadingSpinner size={16} /> : <Download size={16} />}
            Excel
          </button>
        </div>
      </div>

      {/* Date Range Filter */}
      <Card>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-400" />
            <span className="text-sm font-medium text-gray-700">{es.reports.startDate}</span>
          </div>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-400" />
            <span className="text-sm font-medium text-gray-700">{es.reports.endDate}</span>
          </div>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl" role="tablist">
        {tabs.map((tab) => (
          <button key={tab.id} role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${activeTab === tab.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── GENERAL TAB ── */}
      {activeTab === 'general' && (
        <>
          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <MetricCard icon={ShoppingCart} label={es.reports.totalSales} value={String(totalSales)} color="blue" compareLabel={prevSales > 0 ? `vs ${prevSales} anterior` : undefined} compareValue={prevSales > 0 ? ((totalSales - prevSales) / prevSales * 100) : undefined} />
            <MetricCard icon={TrendingUp} label={es.reports.netRevenue} value={formatCurrency(netRevenue)} color="emerald" compareLabel={prevRevenue > 0 ? 'vs período anterior' : undefined} compareValue={prevRevenue > 0 ? ((netRevenue - prevRevenue) / prevRevenue * 100) : undefined} />
            <MetricCard icon={DollarSign} label="Ingresos del mes" value={formatCurrency(monthRevenue)} color="indigo" />
            <MetricCard icon={Package} label={es.reports.inventoryValue} value={formatCurrency(inventoryValue)} color="indigo" />
            <MetricCard icon={DollarSign} label="Ganancia estimada" value={formatCurrency(estimatedProfit)} color="amber" />
            <MetricCard icon={Percent} label="Margen" value={`${profitMargin.toFixed(1)}%`} color="purple" />
          </div>

          {/* Sales Chart */}
          <Card title={es.reports.salesSection}>
            {salesData.length > 0 ? (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} formatter={(value: number, name: string) => {
                      if (name === 'ingresos') return [formatCurrency(value), 'Ingresos'];
                      return [value, 'Ventas'];
                    }} />
                    <Bar dataKey="ventas" fill="#6366f1" radius={[4, 4, 0, 0]} name="ventas" />
                    <Bar dataKey="ingresos" fill="#10b981" radius={[4, 4, 0, 0]} name="ingresos" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState icon={BarChart3} title={es.reports.noData} className="py-8" />
            )}
          </Card>

          {/* Payment Methods */}
          {summary?.paymentMethods && summary.paymentMethods.length > 0 && (
            <Card title="Ingresos por método de pago">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={summary.paymentMethods} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} formatter={(value: number) => [formatCurrency(value), 'Total']} />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]} name="total">
                    {summary.paymentMethods.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={['#6366f1', '#10b981', '#f59e0b'][index % 3]} />
                    ))}
                  </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* Top Products */}
          {summary?.topProducts && summary.topProducts.length > 0 && (
            <Card title="Productos más vendidos">
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">#</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Producto</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Cantidad</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topProducts.map((p, i) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-500 border-b border-gray-100">{i + 1}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 border-b border-gray-100">{p.name}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100 text-right">{p.quantity}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100 text-right">{formatCurrency(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── VENTAS TAB ── */}
      {activeTab === 'ventas' && (
        <div className="space-y-6">
          <Card title="Resumen de ventas">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-4 bg-indigo-50 rounded-xl">
                <p className="text-sm text-indigo-600 font-semibold">Total ventas (período)</p>
                <p className="text-2xl font-bold text-indigo-900">{totalSalesInPeriod || totalSales}</p>
              </div>
              <div className="p-4 bg-emerald-50 rounded-xl">
                <p className="text-sm text-emerald-600 font-semibold">Ingresos (período)</p>
                <p className="text-2xl font-bold text-emerald-900">{formatCurrency(totalRevenueInPeriod || netRevenue)}</p>
              </div>
              <div className="p-4 bg-amber-50 rounded-xl">
                <p className="text-sm text-amber-600 font-semibold">Ticket promedio</p>
                <p className="text-2xl font-bold text-amber-900">{formatCurrency(avgTicket)}</p>
              </div>
            </div>
          </Card>

          <Card title="Tendencia de ventas">
            {salesData.length > 0 ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salesData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }} formatter={(value: number) => [formatCurrency(value), 'Ingresos']} />
                    <Line type="monotone" dataKey="ingresos" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState icon={BarChart3} title={es.reports.noData} className="py-8" />
            )}
          </Card>

          {summary?.paymentMethods && summary.paymentMethods.length > 0 && (
            <Card title="Distribución por método de pago">
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Método</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.paymentMethods.map((pm) => (
                      <tr key={pm.method} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100 flex items-center gap-2"><StatusBadge status={pm.method} label={pm.label} /></td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100 text-right">{formatCurrency(pm.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── INVENTARIO TAB ── */}
      {activeTab === 'inventario' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard icon={Package} label="Valor inventario" value={formatCurrency(inventoryValue)} color="indigo" />
            <MetricCard icon={AlertTriangle} label="Stock crítico" value={String(stockData?.critical.length ?? 0)} color="red" />
            <MetricCard icon={AlertTriangle} label="Stock bajo" value={String(stockData?.warning.length ?? 0)} color="amber" />
            <MetricCard icon={Calendar} label="Vencidos/Próximos" value={String(expiryAlertsTotal)} color="red" />
            <MetricCard icon={Package} label="Sin rotación (>90d)" value={String(noRotation.length)} color="amber" />
          </div>

          {noRotation.length > 0 && (
            <Card title="Productos sin rotación (+90 días sin vender)">
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Código</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Producto</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Stock</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Valor</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Días sin vender</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Última venta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {noRotation.slice(0, 30).map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-500 border-b border-gray-100">{p.code}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 border-b border-gray-100">{p.name}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100 text-right">{p.stock}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100 text-right">{formatCurrency(p.stock * p.cost)}</td>
                        <td className="px-4 py-3 text-sm font-semibold border-b border-gray-100 text-right text-amber-600">{p.daysWithoutSale}d</td>
                        <td className="px-4 py-3 text-sm text-gray-500 border-b border-gray-100">{p.lastSaleDate ? formatDate(p.lastSaleDate) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {noRotation.length > 30 && (
                <p className="text-sm text-gray-400 mt-2 text-center">{noRotation.length - 30} productos más...</p>
              )}
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Stock crítico y bajo">
              {stockData && stockAlertsTotal > 0 ? (
                <div className="space-y-4">
                  {stockData.critical.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Crítico ({stockData.critical.length})</h4>
                      <div className="space-y-1">
                        {stockData.critical.map((p) => (
                          <div key={p.id} className="flex justify-between text-sm px-3 py-2 bg-red-50 rounded-lg">
                            <span className="font-medium text-gray-800">{p.name}</span>
                            <span className="text-red-600 font-semibold">{p.stock} / {p.minStock}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {stockData.warning.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Bajo ({stockData.warning.length})</h4>
                      <div className="space-y-1">
                        {stockData.warning.map((p) => (
                          <div key={p.id} className="flex justify-between text-sm px-3 py-2 bg-amber-50 rounded-lg">
                            <span className="font-medium text-gray-800">{p.name}</span>
                            <span className="text-amber-600 font-semibold">{p.stock} / {p.minStock}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState icon={Package} title="Sin alertas de stock" className="py-8" />
              )}
            </Card>

            <Card title="Productos por vencer">
              {expiryData && expiryAlertsTotal > 0 ? (
                <div className="space-y-4">
                  {expiryData.expired.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Vencidos ({expiryData.expired.length})</h4>
                      <div className="space-y-1">
                        {expiryData.expired.slice(0, 8).map((p) => (
                          <div key={p.id} className="flex justify-between text-sm px-3 py-2 bg-red-50 rounded-lg">
                            <span className="font-medium text-gray-800">{p.name}</span>
                            <span className="text-red-600 font-semibold">{p.expiryDate ? formatDate(p.expiryDate) : '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {expiryData.expiringSoon.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Próximos a vencer ({expiryData.expiringSoon.length})</h4>
                      <div className="space-y-1">
                        {expiryData.expiringSoon.slice(0, 8).map((p) => (
                          <div key={p.id} className="flex justify-between text-sm px-3 py-2 bg-amber-50 rounded-lg">
                            <span className="font-medium text-gray-800">{p.name}</span>
                            <span className="text-amber-600 font-semibold">{p.expiryDate ? formatDate(p.expiryDate) : '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState icon={Calendar} title="Sin productos próximos a vencer" className="py-8" />
              )}
            </Card>
          </div>
        </>
      )}

      {/* ── CAJA TAB ── */}
      {activeTab === 'caja' && (
        <Card title="Cierres de caja">
          {closures.length > 0 ? (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Apertura</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Cierre</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Inicial</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Final</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Esperado</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Diferencia</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {closures.slice(0, 20).map((c) => {
                    const diff = c.finalCash !== null && c.expectedCash !== null ? c.finalCash - c.expectedCash : null;
                    return (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100 whitespace-nowrap">{formatDateTime(c.openedAt)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100 whitespace-nowrap">{c.closedAt ? formatDateTime(c.closedAt) : '—'}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100 text-right whitespace-nowrap">{formatCurrency(c.initialCash)}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 border-b border-gray-100 text-right whitespace-nowrap">{c.finalCash !== null ? formatCurrency(c.finalCash) : '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100 text-right whitespace-nowrap">{c.expectedCash !== null ? formatCurrency(c.expectedCash) : '—'}</td>
                        <td className={`px-4 py-3 text-sm font-semibold border-b border-gray-100 text-right whitespace-nowrap ${diff !== null && diff !== 0 ? (diff > 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-400'}`}>
                          {diff !== null ? `${diff > 0 ? '+' : ''}${formatCurrency(diff)}` : '—'}
                        </td>
                        <td className="px-4 py-3 border-b border-gray-100"><StatusBadge status={c.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Clock} title={es.reports.noData} className="py-8" />
          )}
        </Card>
      )}

      {/* ── AUDITORIA TAB ── */}
      {activeTab === 'auditoria' && (
        <Card title="Registro de auditoría">
          {auditRecords.length > 0 ? (
            <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-96 overflow-y-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200 sticky top-0 bg-gray-50">{es.audit.date}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200 sticky top-0 bg-gray-50">{es.audit.user}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200 sticky top-0 bg-gray-50">{es.audit.action}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200 sticky top-0 bg-gray-50">{es.audit.entity}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200 sticky top-0 bg-gray-50">{es.audit.payload}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRecords.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100 whitespace-nowrap">{formatDateTime(r.date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100">{r.user}</td>
                      <td className="px-4 py-3 border-b border-gray-100"><StatusBadge status={r.action} /></td>
                      <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100">{r.entity}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 border-b border-gray-100 max-w-xs truncate">{r.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={BarChart3} title="Sin registros de auditoría" description="Las acciones del sistema se registrarán aquí" className="py-8" />
          )}
        </Card>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, color, compareLabel, compareValue }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  label: string;
  value: string;
  color: string;
  compareLabel?: string;
  compareValue?: number;
}): JSX.Element {
  const iconBgMap: Record<string, string> = {
    blue: '#dbeafe', emerald: '#ecfdf3', indigo: '#eef2ff', amber: '#fffaeb', purple: '#faf5ff', cyan: '#cffafe', red: '#fef2f2',
  };
  return (
    <div className="tc-metric">
      <div className="flex items-center justify-between mb-3">
        <div className="tc-metric-icon" style={{ background: iconBgMap[color] ?? 'var(--gray-100)' }}>
          <Icon size={20} />
        </div>
      </div>
      <p className="tc-metric-label">{label}</p>
      <p className="tc-metric-value">{value}</p>
      {compareLabel && compareValue !== undefined && (
        <span className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-1.5 pr-2.5 text-sm font-medium mt-2 ${compareValue >= 0 ? 'bg-success-50 text-success-600' : 'bg-error-50 text-error-600'}`}>
          {compareValue >= 0 ? (
            <svg className="fill-current" width="12" height="12" viewBox="0 0 12 12"><path fillRule="evenodd" clipRule="evenodd" d="M5.56462 1.62393C5.70193 1.47072 5.90135 1.37432 6.12329 1.37432C6.1236 1.37432 6.12391 1.37432 6.12422 1.37432C6.31631 1.37415 6.50845 1.44731 6.65505 1.59381L9.65514 4.5918C9.94814 4.88459 9.94831 5.35947 9.65552 5.65246C9.36273 5.94546 8.88785 5.94562 8.59486 5.65283L6.87329 3.93247L6.87329 10.125C6.87329 10.5392 6.53751 10.875 6.12329 10.875C5.70908 10.875 5.37329 10.5392 5.37329 10.125L5.37329 3.93578L3.65516 5.65282C3.36218 5.94562 2.8873 5.94547 2.5945 5.65248C2.3017 5.35949 2.30185 4.88462 2.59484 4.59182L5.56462 1.62393Z"/></svg>
          ) : (
            <svg className="fill-current" width="12" height="12" viewBox="0 0 12 12"><path fillRule="evenodd" clipRule="evenodd" d="M5.31462 10.3761C5.45194 10.5293 5.65136 10.6257 5.87329 10.6257C5.8736 10.6257 5.8739 10.6257 5.87421 10.6257C6.0663 10.6259 6.25845 10.5527 6.40505 10.4062L9.40514 7.4082C9.69814 7.11541 9.69831 6.64054 9.40552 6.34754C9.11273 6.05454 8.63785 6.05438 8.34486 6.34717L6.62329 8.06753L6.62329 1.875C6.62329 1.46079 6.28751 1.125 5.87329 1.125C5.45908 1.125 5.12329 1.46079 5.12329 1.875L5.12329 8.06422L3.40516 6.34719C3.11218 6.05439 2.6373 6.05454 2.3445 6.34752C2.0517 6.64051 2.05185 7.11538 2.34484 7.40818L5.31462 10.3761Z"/></svg>
          )}
          {compareValue >= 0 ? '+' : ''}{compareValue.toFixed(1)}%
        </span>
      )}
    </div>
  );
}
