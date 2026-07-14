import { useState, useEffect } from 'react';
import { Bell, AlertTriangle, Package, Calendar, ChevronRight, ShieldAlert } from 'lucide-react';
import { trpc } from '../../trpc';
import { formatDate } from '../../shared/utils/formatters';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { EmptyState } from '../../shared/components/EmptyState';
import type { StockAlerts, ExpiryAlerts, Product } from '../../shared/types/inventory.types';

type Tab = 'stock' | 'expiry';

export default function AlertsPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>('stock');
  const [stockData, setStockData] = useState<StockAlerts | null>(null);
  const [expiryData, setExpiryData] = useState<ExpiryAlerts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchAlerts = async () => {
      setLoading(true);
      try {
        const [stock, expiry] = await Promise.all([
          trpc.inventory.getStockAlerts.query(),
          trpc.inventory.getExpiryAlerts.query(),
        ]);
        if (cancelled) return;
        setStockData(stock as StockAlerts);
        setExpiryData(expiry as ExpiryAlerts);
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchAlerts();
    return () => { cancelled = true; };
  }, []);

  const totalCritical = (stockData?.critical.length ?? 0) + (expiryData?.expired.length ?? 0);
  const totalWarning = (stockData?.warning.length ?? 0) + (expiryData?.expiringSoon.length ?? 0);
  const totalAlerts = totalCritical + totalWarning;

  const stockAlertsList: Product[] = [
    ...(stockData?.critical ?? []),
    ...(stockData?.warning ?? []),
  ];

  const expiryAlertsList: Product[] = [
    ...(expiryData?.expired ?? []),
    ...(expiryData?.expiringSoon ?? []),
  ];

  const getDaysUntilExpiry = (dateStr: string): number => {
    const diff = new Date(dateStr).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
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
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
          <Bell size={16} />
          <span>{es.alerts.title}</span>
          <ChevronRight size={14} />
          <span className="text-indigo-600 font-semibold">{es.alerts.subtitle}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{es.alerts.title}</h1>
        <p className="text-sm text-gray-500">{es.alerts.subtitle}</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
              <Bell size={20} className="text-gray-500" />
            </div>
            <div>
              <p className="text-sm text-gray-500">{es.alerts.totalAlerts}</p>
              <p className="text-xl font-bold text-gray-900">{totalAlerts}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${totalCritical > 0 ? 'bg-red-100' : 'bg-gray-100'}`}>
              <ShieldAlert size={20} className={totalCritical > 0 ? 'text-red-600' : 'text-gray-400'} />
            </div>
            <div>
              <p className="text-sm text-gray-500">{es.alerts.severity} crítico</p>
              <p className="text-xl font-bold text-gray-900">{totalCritical}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${totalWarning > 0 ? 'bg-amber-100' : 'bg-gray-100'}`}>
              <AlertTriangle size={20} className={totalWarning > 0 ? 'text-amber-600' : 'text-gray-400'} />
            </div>
            <div>
              <p className="text-sm text-gray-500">{es.alerts.severity} advertencia</p>
              <p className="text-xl font-bold text-gray-900">{totalWarning}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('stock')}
          className={`px-4 py-2 text-sm font-semibold rounded-md transition-all border-none cursor-pointer ${
            activeTab === 'stock' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-2">
            <Package size={16} />
            {es.alerts.stockCritical}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('expiry')}
          className={`px-4 py-2 text-sm font-semibold rounded-md transition-all border-none cursor-pointer ${
            activeTab === 'expiry' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="flex items-center gap-2">
            <Calendar size={16} />
            {es.alerts.expiringCritical}
          </span>
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'stock' ? (
        <Card title={es.inventory.stockAlerts}>
          {stockAlertsList.length > 0 ? (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.product}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.code}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.stock}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.minStock}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.severity}</th>
                  </tr>
                </thead>
                <tbody>
                  {stockAlertsList.map((product) => (
                    <tr key={`stock-${product.id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-800 border-b border-gray-100">{product.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 border-b border-gray-100 font-mono">{product.code}</td>
                      <td className="px-4 py-3 text-sm font-semibold border-b border-gray-100">
                        <span className={product.stock <= product.criticalStock ? 'text-red-600' : 'text-amber-600'}>
                          {product.stock}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100">{product.minStock}</td>
                      <td className="px-4 py-3 border-b border-gray-100">
                        <StatusBadge
                          status={product.stock <= product.criticalStock ? 'critical' : 'warning'}
                          label={product.stock <= product.criticalStock ? es.inventory.stockCritical : es.inventory.stockWarning}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Package} title={es.alerts.noAlerts} />
          )}
        </Card>
      ) : (
        <Card title={es.inventory.expiryAlerts}>
          {expiryAlertsList.length > 0 ? (
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.product}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.code}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.stock}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.expiryDate}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.daysUntil}</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">{es.alerts.severity}</th>
                  </tr>
                </thead>
                <tbody>
                  {expiryAlertsList.map((product) => {
                    const days = product.expiryDate ? getDaysUntilExpiry(product.expiryDate) : 0;
                    const isExpired = days === 0;
                    return (
                      <tr key={`expiry-${product.id}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-800 border-b border-gray-100">{product.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 border-b border-gray-100 font-mono">{product.code}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100">{product.stock}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100 whitespace-nowrap">
                          {product.expiryDate ? formatDate(product.expiryDate) : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold border-b border-gray-100">
                          <span className={isExpired ? 'text-red-600' : 'text-amber-600'}>
                            {isExpired ? 'Vencido' : `${days} días`}
                          </span>
                        </td>
                        <td className="px-4 py-3 border-b border-gray-100">
                          <StatusBadge
                            status={isExpired ? 'expired' : 'warning'}
                            label={isExpired ? es.inventory.expiredNow : es.inventory.expiredSoon}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Calendar} title={es.alerts.noAlerts} />
          )}
        </Card>
      )}
    </div>
  );
}
