import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, FileText, XCircle, ShoppingCart, Calendar, CreditCard, Package, ChevronRight, X, User, DollarSign, Search, Download, FileSpreadsheet } from 'lucide-react';

import { trpc } from '../../trpc';
import { useAuth } from '../../shared/context/AuthContext';
import { formatCurrency, formatDate, formatDateTime } from '../../shared/utils/formatters';
import type { SaleRecord, SaleItem, SalePayment } from '../../shared/types/sales.types';
import { ConfirmDialog } from '../../shared/components/ConfirmDialog';

function getPaymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    efectivo: 'Efectivo',
    nequi: 'Nequi',
    daviplata: 'Daviplata',
    tarjeta: 'Tarjeta',
    transferencia: 'Transferencia',
    credito: 'Crédito',
  };
  return labels[method] || method;
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'tc-badge--success';
    case 'CANCELLED':
      return 'tc-badge--danger';
    case 'PENDING':
      return 'tc-badge--warning';
    default:
      return 'tc-badge--neutral';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'Completada';
    case 'CANCELLED':
      return 'Cancelada';
    case 'PENDING':
      return 'Pendiente';
    default:
      return status;
  }
}

interface DateRange {
  startDate: string;
  endDate: string;
}

export function SalesHistoryPage(): JSX.Element {
  const { user, isAuthorized, currentBranch } = useAuth();
  const navigate = useNavigate();

  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [saleToCancel, setSaleToCancel] = useState<SaleRecord | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [selectedSale, setSelectedSale] = useState<SaleRecord | null>(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [exporting, setExporting] = useState(false);

  // Date range filter
  const today = new Date();
  const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [startDate, setStartDate] = useState(defaultStart.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);

  const canCancel = isAuthorized(['ADMIN', 'SUPERVISOR']);

  const loadSales = useCallback(async (range: DateRange): Promise<void> => {
    if (!user) return;
    setLoading(true);
    setMessage('');
    const branchId = currentBranch?.id;
    try {
      const result = await trpc.sales.getByDateRange.query({ ...range, branchId });
      const data = result as SaleRecord[];
      setSales(data || []);
    } catch {
      setMessage('Error al cargar ventas');
      setMessageType('error');
      setSales([]);
    } finally {
      setLoading(false);
    }
  }, [user, currentBranch]);

  useEffect(() => {
    void loadSales({ startDate, endDate });
  }, [loadSales, startDate, endDate]);

  const handleSearch = (): void => {
    if (!searchQuery.trim()) {
      void loadSales({ startDate, endDate });
      return;
    }
    const lower = searchQuery.toLowerCase();
    const filtered = sales.filter((s) => {
      if (s.saleNumber.toLowerCase().includes(lower)) return true;
      if (s.customer?.name?.toLowerCase().includes(lower)) return true;
      if (s.customer?.phone?.toLowerCase().includes(lower)) return true;
      if (formatCurrency(s.total).toLowerCase().includes(lower)) return true;
      if (s.payments.some((p) => getPaymentMethodLabel(p.method).toLowerCase().includes(lower))) return true;
      return false;
    });
    setSales(filtered);
  };

  const handleExport = async (format: 'csv' | 'xlsx' = 'csv') => {
    setExporting(true);
    const branchId = currentBranch?.id;
    try {
      const result = await trpc.export.sales.mutate({ dateFrom: startDate, dateTo: endDate, branchId, format });
      const { path } = result as { path: string };
      if (path && window.api?.openFile) {
        await window.api.openFile(path);
        setMessageType('success');
        setMessage(`Ventas exportadas (${format.toUpperCase()}): ${path.split(/[/\\]/).pop()}`);
      }
    } catch (err) {
      rendererLogger.error('SalesHistoryPage', 'Export error:', err);
      setMessageType('error');
      setMessage('Error al exportar ventas');
    } finally {
      setExporting(false);
    }
    setTimeout(() => setMessage(''), 4000);
  };

  const handleCancelSale = (sale: SaleRecord): void => {
    if (!user || sale.status === 'CANCELLED') return;
    setSaleToCancel(sale);
  };

  const confirmCancelSale = async (): Promise<void> => {
    const sale = saleToCancel;
    if (!sale || !user) return;
    setCancelling(true);
    try {
      const result = await trpc.sales.cancel.mutate({ id: sale.id, userId: user.id });
      const response = result as { success: boolean };
      if (response.success) {
        setSales((prev) =>
          prev.map((item) => (item.id === sale.id ? { ...item, status: 'CANCELLED' } : item)),
        );
        setSelectedSale((prev) =>
          prev?.id === sale.id ? { ...prev, status: 'CANCELLED' } : prev,
        );
        setMessageType('success');
        setMessage(`Venta #${sale.saleNumber} cancelada exitosamente.`);
      }
    } catch (err) {
      setMessageType('error');
      setMessage(err instanceof Error ? err.message : 'Error al cancelar la venta');
    } finally {
      setCancelling(false);
      setSaleToCancel(null);
      setTimeout(() => setMessage(''), 4000);
    }
  };

  const handleInvoice = async (saleId: number): Promise<void> => {
    try {
      const result = await trpc.sales.generateInvoice.mutate({ saleId });
      if (result) {
        const invoice = result as { status: string; cufe: string };
        setMessageType('success');
        setMessage(`Factura generada: CUFE ${invoice.cufe}`);
      }
    } catch (err) {
      setMessageType('error');
      setMessage(err instanceof Error ? err.message : 'Error al generar factura');
    }
    setTimeout(() => setMessage(''), 4000);
  };

  const groupedSales = useMemo(() => {
    const groups: Record<string, SaleRecord[]> = {};
    const filtered = searchQuery.trim()
      ? sales.filter((s) => s.saleNumber.toLowerCase().includes(searchQuery.toLowerCase()))
      : sales;

    filtered.forEach((sale) => {
      const d = new Date(sale.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(sale);
    });
    return groups;
  }, [sales, searchQuery]);

  const sortedDates = useMemo(
    () => Object.keys(groupedSales).sort((a, b) => b.localeCompare(a)),
    [groupedSales],
  );

  return (
    <div className="tc-page-container">
      {/* Page Header */}
      <section className="tc-section animate-slideDown">
        <div className="tc-section-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Ventas
              </span>
              <ChevronRight size={16} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--brand-600)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Historial
              </span>
            </div>
            <h2 className="tc-section-title" style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-1)' }}>
              Historial de Ventas
            </h2>
            <p className="tc-section-subtitle">Consulte y gestione todas las ventas realizadas.</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button onClick={() => handleExport('csv')} disabled={exporting} className="tc-btn tc-btn--secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Download size={16} />
              {exporting ? 'Exportando...' : 'CSV'}
            </button>
            <button onClick={() => handleExport('xlsx')} disabled={exporting} className="tc-btn tc-btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <FileSpreadsheet size={16} />
              {exporting ? 'Exportando...' : 'XLSX'}
            </button>
            <button onClick={() => navigate('/sales')} className="tc-btn tc-btn--primary">
              <ShoppingCart size={18} style={{ marginRight: 'var(--space-2)' }} />
              Nuevo POS
            </button>
          </div>
        </div>

        {message && (
          <div className={`tc-notice tc-notice--${messageType === 'success' ? 'success' : messageType === 'error' ? 'error' : 'info'}`}
            style={{ marginTop: 'var(--space-4)', animation: 'slideDown 0.3s ease-out', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{message}</span>
            <button onClick={() => setMessage('')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '4px' }}>
              <X size={16} />
            </button>
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 'var(--space-6)', padding: 'var(--space-4)', background: 'var(--gray-50)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--border-light)' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--gray-600)', marginBottom: '4px' }}>Fecha Inicio</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="tc-input" style={{ minHeight: '40px', fontSize: 'var(--text-sm)' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--gray-600)', marginBottom: '4px' }}>Fecha Fin</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="tc-input" style={{ minHeight: '40px', fontSize: 'var(--text-sm)' }} />
          </div>
          <button onClick={() => void loadSales({ startDate, endDate })} className="tc-btn tc-btn--primary" style={{ minHeight: '40px' }}>
            <Calendar size={16} style={{ marginRight: 'var(--space-2)' }} />
            Filtrar
          </button>
          <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} size={16} />
            <input
              type="text"
              placeholder="Buscar por número de venta..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              className="tc-input"
              style={{ paddingLeft: '36px', minHeight: '40px', fontSize: 'var(--text-sm)' }}
            />
          </div>
        </div>
      </section>

      {/* Sales List */}
      <section className="tc-section animate-slideUp">
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-12)' }}>
            <div className="tc-skeleton tc-skeleton--circle" style={{ width: '48px', height: '48px' }} />
            <div className="tc-skeleton tc-skeleton--title" style={{ width: '200px' }} />
            <div className="tc-skeleton tc-skeleton--text" style={{ width: '150px' }} />
          </div>
        ) : sales.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-12)', textAlign: 'center' }}>
            <div style={{ width: '80px', height: '80px', borderRadius: 'var(--radius-2xl)', background: 'var(--gradient-card-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-600)', marginBottom: 'var(--space-4)' }}>
              <ShoppingCart size={48} />
            </div>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--gray-900)', marginBottom: 'var(--space-2)' }}>
              No hay ventas en este período
            </h3>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--gray-500)', maxWidth: '320px' }}>
              No se encontraron ventas entre {formatDate(startDate)} y {formatDate(endDate)}. Intente con un rango de fechas diferente.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            {sortedDates.length === 0 && searchQuery.trim() ? (
              <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--gray-500)' }}>
                <p style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--gray-700)', marginBottom: 'var(--space-2)' }}>
                  No se encontraron ventas con el criterio de búsqueda.
                </p>
                <p style={{ fontSize: 'var(--text-sm)' }}>Pruebe con otro número de venta o limpie la búsqueda.</p>
              </div>
            ) : (
              sortedDates.map((dateKey) => {
                const daySales = groupedSales[dateKey];
                const completedSales = daySales.filter((s) => s.status === 'COMPLETED');
                const cancelledSales = daySales.filter((s) => s.status === 'CANCELLED');
                const dayTotal = completedSales.reduce((sum, s) => sum + s.total, 0);

                const isToday = dateKey === new Date().toISOString().split('T')[0];

                return (
                  <div key={dateKey} style={{ animation: 'slideUp 0.3s ease-out' }}>
                    {/* Day header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', background: isToday ? 'var(--gradient-primary)' : 'var(--gray-100)', border: isToday ? 'none' : '1px solid var(--border-light)', borderBottom: 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <Calendar size={16} />
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: isToday ? '#fff' : 'var(--gray-900)', textTransform: 'capitalize' }}>
                          {new Date(dateKey + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}
                          {isToday && <span style={{ marginLeft: 'var(--space-2)', padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'rgba(255,255,255,0.2)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>HOY</span>}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: isToday ? 'rgba(255,255,255,0.8)' : 'var(--gray-500)' }}>
                          {completedSales.length} venta{completedSales.length !== 1 ? 's' : ''}
                          {cancelledSales.length > 0 && ` · ${cancelledSales.length} cancelada${cancelledSales.length !== 1 ? 's' : ''}`}
                        </span>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: isToday ? '#fff' : 'var(--brand-600)' }}>
                          {formatCurrency(dayTotal)}
                        </span>
                      </div>
                    </div>

                    {/* Table */}
                    <div className="tc-table-wrap" style={{ borderRadius: '0 0 var(--radius-2xl) var(--radius-2xl)', border: '1px solid var(--border-light)', borderTop: 'none' }}>
                      <table className="tc-table" style={{ textAlign: 'center' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'center' }}># Venta</th>
                            <th style={{ textAlign: 'center' }}>Fecha / Hora</th>
                            <th style={{ textAlign: 'center' }}>Cliente</th>
                            <th style={{ textAlign: 'center' }}>Items</th>
                            <th style={{ textAlign: 'center' }}>Total</th>
                            <th style={{ textAlign: 'center' }}>Métodos de Pago</th>
                            <th style={{ textAlign: 'center' }}>Estado</th>
                            <th style={{ textAlign: 'center' }}>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {daySales.map((sale) => (
                            <tr key={sale.id}>
                              <td style={{ textAlign: 'center' }}>
                                <span style={{ fontWeight: 600, color: 'var(--gray-900)' }}>#{sale.saleNumber}</span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-600)', fontWeight: 500 }}>
                                    {formatDate(sale.createdAt)}
                                  </span>
                                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)' }}>
                                    {new Date(sale.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                {sale.customer ? (
                                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--gray-800)' }}>
                                    {sale.customer.name}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-400)' }}>Consumidor Final</span>
                                )}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: 'var(--radius-md)', background: 'var(--brand-100)', color: 'var(--brand-600)', fontSize: 'var(--text-xs)', fontWeight: 700 }}>
                                  {sale.items.length}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span style={{ fontWeight: 700, color: 'var(--gray-900)' }}>{formatCurrency(sale.total)}</span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center' }}>
                                  {sale.payments.map((p) => (
                                    <span key={p.id} className="tc-badge tc-badge--neutral" style={{ fontSize: 'var(--text-xs)', padding: '2px 6px', textTransform: 'capitalize' }}>
                                      {getPaymentMethodLabel(p.method)}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span className={`tc-badge ${getStatusBadgeClass(sale.status)}`}>
                                  {getStatusLabel(sale.status)}
                                </span>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
                                  <button type="button" onClick={() => setSelectedSale(sale)} className="tc-btn tc-btn--ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--brand-600)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                                    <Eye size={16} /> Ver
                                  </button>
                                  <button type="button" onClick={() => void handleInvoice(sale.id)} className="tc-btn tc-btn--ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--gray-700)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                                    <FileText size={16} /> Factura
                                  </button>
                                  {sale.status !== 'CANCELLED' && canCancel && (
                                    <button type="button" onClick={() => void handleCancelSale(sale)} className="tc-btn tc-btn--ghost" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--danger-600)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                                      <XCircle size={16} /> Cancelar
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      {/* Sale Detail Modal */}
      {selectedSale && (
        <SaleDetailModal
          sale={selectedSale}
          onClose={() => setSelectedSale(null)}
          onGenerateInvoice={handleInvoice}
          onCancel={canCancel && selectedSale.status !== 'CANCELLED' ? handleCancelSale : undefined}
        />
      )}

      <ConfirmDialog
        isOpen={saleToCancel !== null}
        onClose={() => setSaleToCancel(null)}
        onConfirm={confirmCancelSale}
        title="Cancelar venta"
        message={saleToCancel ? `¿Está seguro de cancelar la venta #${saleToCancel.saleNumber}?` : ''}
        confirmLabel="Cancelar venta"
        variant="danger"
        loading={cancelling}
      />
    </div>
  );
}

// ============================================================
// SALE DETAIL MODAL
// ============================================================

function SaleDetailModal({
  sale,
  onClose,
  onGenerateInvoice,
  onCancel,
}: {
  sale: SaleRecord;
  onClose: () => void;
  onGenerateInvoice: (saleId: number) => void;
  onCancel?: (sale: SaleRecord) => void;
}): JSX.Element {
  return (
    <div className="tc-modal-overlay" onClick={onClose} style={{ animation: 'fadeIn 0.2s ease-out' }}>
      <div className="tc-modal" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 'min(640px, 100%)', padding: 0, gap: 0, animation: 'scaleIn 0.3s ease-out', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ background: 'var(--gradient-primary)', padding: 'var(--space-6)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    # Venta
                  </span>
                  <span className={`tc-badge ${getStatusBadgeClass(sale.status)}`}
                    style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}>
                    {getStatusLabel(sale.status)}
                  </span>
                </div>
                <h3 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: '#fff' }}>#{sale.saleNumber}</h3>
              </div>
              <button type="button" onClick={onClose}
                style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'rgba(255,255,255,0.85)', fontSize: 'var(--text-sm)' }}>
              <Calendar size={16} />
              {formatDateTime(sale.createdAt)}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxHeight: '60vh', overflowY: 'auto' }}>
          {/* Info grid */}
          <div className="tc-grid-2">
            <div className="tc-field">
              <label className="tc-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <User size={16} />
                Vendedor
              </label>
              <p style={{ color: 'var(--gray-800)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                {sale.user?.fullName || `Usuario #${sale.userId}`}
              </p>
            </div>
            <div className="tc-field">
              <label className="tc-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Package size={16} />
                Productos
              </label>
              <p style={{ color: 'var(--gray-800)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                {sale.items.length} producto(s)
              </p>
            </div>
            {sale.customer && (
              <div className="tc-field">
                <label className="tc-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <User size={16} />
                  Cliente
                </label>
                <p style={{ color: 'var(--gray-800)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                  {sale.customer.name}
                  {sale.customer.phone && <span style={{ color: 'var(--gray-500)', fontWeight: 400 }}> · {sale.customer.phone}</span>}
                </p>
              </div>
            )}
          </div>

          {/* Products table */}
          <div>
            <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--gray-900)', marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Productos
            </h4>
            <div className="tc-table-wrap" style={{ borderRadius: 'var(--radius-2xl)' }}>
              <table className="tc-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cant.</th>
                    <th>Precio</th>
                    <th>Dto.</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((item: SaleItem) => (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600, color: 'var(--gray-900)' }}>{item.product.name}</td>
                      <td>{item.quantity}</td>
                      <td>{formatCurrency(item.unitPrice)}</td>
                      <td>{item.discount > 0 ? formatCurrency(item.discount) : '-'}</td>
                      <td style={{ fontWeight: 600, color: 'var(--gray-900)' }}>{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment summary */}
          <div style={{ borderRadius: 'var(--radius-xl)', background: 'var(--gradient-card-brand)', border: '1px solid var(--brand-100)', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--gray-900)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <DollarSign size={16} />
              Resumen de Pago
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <SummaryRow label="Subtotal" value={formatCurrency(sale.subtotal)} />
              <SummaryRow label="IVA" value={formatCurrency(sale.tax)} />
              {sale.discount > 0 && <SummaryRow label="Descuento" value={`-${formatCurrency(sale.discount)}`} />}
              {sale.deliveryFee > 0 && <SummaryRow label="Delivery" value={formatCurrency(sale.deliveryFee)} />}
              <div style={{ height: '1px', background: 'var(--brand-200)', margin: 'var(--space-1) 0' }} />
              <SummaryRow label="Total" value={formatCurrency(sale.total)} strong />
              {sale.change > 0 && <SummaryRow label="Cambio" value={formatCurrency(sale.change)} />}
            </div>
          </div>

          {/* Payments */}
          {sale.payments.length > 0 && (
            <div style={{ borderRadius: 'var(--radius-xl)', background: 'var(--gray-50)', border: '1px solid var(--border-light)', padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--gray-900)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <CreditCard size={16} />
                Métodos de Pago
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {sale.payments.map((payment: SalePayment) => (
                  <div key={payment.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', background: '#fff', border: '1px solid var(--border-light)' }}>
                    <span style={{ textTransform: 'capitalize', color: 'var(--gray-700)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <CreditCard size={16} />
                      {getPaymentMethodLabel(payment.method)}
                      {payment.reference && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-400)' }}>({payment.reference})</span>}
                    </span>
                    <span style={{ fontWeight: 700, color: 'var(--gray-900)' }}>{formatCurrency(payment.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cash session info */}
          {sale.cashSession && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-400)', textAlign: 'center' }}>
              Sesión de caja #{sale.cashSession.id} · Abierta: {formatDateTime(sale.cashSession.openedAt)}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-light)', background: 'var(--gray-50)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button type="button" onClick={onClose} className="tc-btn tc-btn--secondary">Cerrar</button>
          {sale.status !== 'CANCELLED' && (
            <>
              <button type="button" onClick={() => void onGenerateInvoice(sale.id)} className="tc-btn tc-btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <FileText size={16} /> Generar Factura
              </button>
              {onCancel && (
                <button type="button" onClick={() => onCancel(sale)} className="tc-btn tc-btn--danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <XCircle size={16} /> Cancelar Venta
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
      <span style={strong ? { color: 'var(--gray-900)', fontWeight: 800, fontSize: 'var(--text-lg)' } : { color: 'var(--gray-600)' }}>
        {label}
      </span>
      <span style={strong ? { color: 'var(--brand-600)', fontWeight: 800, fontSize: 'var(--text-lg)' } : { color: 'var(--gray-800)', fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}
