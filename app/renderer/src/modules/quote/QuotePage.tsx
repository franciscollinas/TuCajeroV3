import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, Trash2, ShoppingCart, Package, User, X } from 'lucide-react';
import { trpc } from '../../trpc';
import { useAuth } from '../../shared/context/AuthContext';
import { useCashStore } from '../../shared/store/cash.store';
import { formatCurrency, formatDateTime } from '../../shared/utils/formatters';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { EmptyState } from '../../shared/components/EmptyState';
import { ConfirmDialog } from '../../shared/components/ConfirmDialog';
import type { SaleRecord, PaymentMethod } from '../../shared/types/sales.types';
import type { Product, Category } from '../../shared/types/inventory.types';
import type { Customer } from '../../shared/store/cart.store';

interface QuoteItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'nequi', label: 'Nequi' },
  { value: 'daviplata', label: 'Daviplata' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'credito', label: 'Crédito' },
];

export default function QuotePage(): JSX.Element {
  const { user } = useAuth();
  const { session: activeCash, fetchSession } = useCashStore();

  const [quotes, setQuotes] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  // Products & customers for the form
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formCustomer, setFormCustomer] = useState<Customer | null>(null);
  const [formItems, setFormItems] = useState<QuoteItem[]>([]);
  const [formDiscount, setFormDiscount] = useState(0);
  const [formDelivery, setFormDelivery] = useState(0);
  const [saving, setSaving] = useState(false);

  // Convert to sale
  const [convertQuote, setConvertQuote] = useState<SaleRecord | null>(null);
  const [convertPayments, setConvertPayments] = useState<{ method: PaymentMethod; amount: number; reference: string }[]>([]);
  const [converting, setConverting] = useState(false);

  // Confirm delete
  const [deleteTarget, setDeleteTarget] = useState<SaleRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [productSearch, setProductSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  const fetchQuotes = useCallback(async () => {
    if (!user) return;
    try {
      const data = await trpc.quotes.list.query({ userId: user.id });
      setQuotes(data as SaleRecord[]);
    } catch {
      showMessage('Error al cargar cotizaciones.', 'error');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const fetchFormData = useCallback(async () => {
    try {
      const [prodResult, catResult] = await Promise.all([
        trpc.inventory.getAll.query({ page: 1, pageSize: 500 }),
        trpc.inventory.getCategories.query(),
      ]);
      const pd = prodResult as { products: Product[] };
      setProducts(pd.products ?? []);
      setCategories(catResult as Category[]);
    } catch {
      // ignore
    }
  }, []);

  const searchCustomers = useCallback(async (term: string) => {
    if (term.length < 2) { setCustomers([]); return; }
    try {
      const result = await trpc.customers.search.query({ query: term });
      setCustomers(result as Customer[]);
    } catch {
      setCustomers([]);
    }
  }, []);

  useEffect(() => { fetchQuotes(); }, [fetchQuotes]);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormCustomer(null);
    setFormItems([]);
    setFormDiscount(0);
    setFormDelivery(0);
    setProductSearch('');
    setCategoryFilter('');
  };

  const openNewForm = () => {
    resetForm();
    fetchFormData();
    setShowForm(true);
  };

  const openEditForm = async (quote: SaleRecord) => {
    fetchFormData();
    setEditingId(quote.id);
    setFormItems(quote.items.map((i) => ({
      productId: i.productId,
      productName: (i as unknown as { product?: { name: string } }).product?.name ?? `#${i.productId}`,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
    })));
    setFormDiscount(quote.discount);
    setFormDelivery(quote.deliveryFee);
    if (quote.customer) {
      setFormCustomer({
        id: quote.customer.id,
        name: quote.customer.name,
        phone: quote.customer.phone ?? null,
      });
    }
    setShowForm(true);
  };

  const addItemToForm = (product: Product) => {
    const existing = formItems.find((i) => i.productId === product.id);
    if (existing) {
      setFormItems(formItems.map((i) =>
        i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i,
      ));
    } else {
      setFormItems([
        ...formItems,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPrice: product.price,
          discount: 0,
        },
      ]);
    }
    setProductSearch('');
  };

  const removeFormItem = (productId: number) => {
    setFormItems(formItems.filter((i) => i.productId !== productId));
  };

  const handleSave = async () => {
    if (formItems.length === 0) return;
    if (!user) return;
    setSaving(true);
    try {
      const input = {
        userId: user.id,
        items: formItems.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discount: i.discount,
        })),
        customerId: formCustomer?.id,
        discount: formDiscount,
        deliveryFee: formDelivery,
      };

      if (editingId) {
        await trpc.quotes.update.mutate({ id: editingId, ...input });
        showMessage(es.quote.quoteUpdated, 'success');
      } else {
        await trpc.quotes.create.mutate(input);
        showMessage(es.quote.quoteCreated, 'success');
      }
      resetForm();
      await fetchQuotes();
    } catch {
      showMessage('Error al guardar cotización.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (!user) return;
    setDeleting(true);
    try {
      await trpc.quotes.delete.mutate({ id: deleteTarget.id, userId: user.id });
      showMessage(es.quote.quoteDeleted, 'success');
      setDeleteTarget(null);
      await fetchQuotes();
    } catch {
      showMessage('Error al eliminar.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleConvertToSale = async () => {
    if (!convertQuote || convertPayments.length === 0) return;
    if (!user) return;
    setConverting(true);
    try {
      if (!activeCash) {
        await fetchSession(user.id);
      }
      const session = activeCash ?? useCashStore.getState().session;
      if (!session) {
        showMessage('Debes abrir caja primero.', 'error');
        setConverting(false);
        return;
      }
      await trpc.quotes.convertToSale.mutate({
        id: convertQuote.id,
        cashSessionId: session.id,
        userId: user.id,
        payments: convertPayments.map((p) => ({
          method: p.method,
          amount: p.amount,
          reference: p.reference || undefined,
        })),
      });
      showMessage(es.quote.saleComplete, 'success');
      setConvertQuote(null);
      setConvertPayments([]);
      await fetchQuotes();
    } catch {
      showMessage('Error al convertir.', 'error');
    } finally {
      setConverting(false);
    }
  };

  const calcSubtotal = formItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const calcTotal = calcSubtotal + formDelivery - formDiscount;

  const filteredProducts = products.filter((p) => {
    const matchSearch = !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.code.toLowerCase().includes(productSearch.toLowerCase());
    const matchCat = !categoryFilter || p.categoryId === Number(categoryFilter);
    return matchSearch && matchCat && p.isActive;
  });

  if (loading) return <div className="flex items-center justify-center h-96"><LoadingSpinner size={40} /></div>;

  return (
    <div className="tc-page">
      <div className="tc-page-header">
        <div>
          <span className="tc-badge tc-badge--brand tc-badge--sm" style={{ marginBottom: 'var(--space-2)' }}>
            <FileText size={14} />
            <span>{es.quote.title}</span>
          </span>
          <h1 className="tc-page-title">{es.quote.title}</h1>
          <p className="tc-page-subtitle">{es.quote.subtitle}</p>
        </div>
        <button type="button" onClick={openNewForm} className="tc-btn tc-btn--primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Plus size={16} /> {es.quote.newQuote}
        </button>
      </div>

      {message && (
        <div className={`tc-message tc-message--${messageType}`}>{message}</div>
      )}

      {/* Quote Form Modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: 'var(--space-6)', overflow: 'auto',
        }}>
          <div style={{
            background: '#fff', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 800,
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden',
          }}>
            <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--gray-900)', margin: 0 }}>
                {editingId ? es.quote.editQuote : es.quote.newQuote}
              </h2>
              <button type="button" onClick={resetForm} className="tc-btn--ghost" style={{ padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {/* Customer */}
              <div className="tc-field">
                <label className="tc-label"><User size={14} /> {es.quote.customer}</label>
                <input
                  className="tc-input"
                  value={customerSearch}
                  onChange={(e) => { setCustomerSearch(e.target.value); searchCustomers(e.target.value); }}
                  placeholder={es.quote.selectCustomer}
                />
                {customers.length > 0 && (
                  <div style={{ marginTop: 4, border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', maxHeight: 150, overflow: 'auto' }}>
                    {customers.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => { setFormCustomer(c); setCustomers([]); setCustomerSearch(c.name); }}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 'var(--text-sm)', borderBottom: '1px solid var(--gray-100)' }}
                      >
                        {c.name} {c.phone && <span style={{ color: 'var(--gray-400)' }}>· {c.phone}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {formCustomer && !customerSearch && (
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span className="tc-badge" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)' }}>
                      {formCustomer.name}
                    </span>
                    <button type="button" onClick={() => { setFormCustomer(null); setCustomerSearch(''); }} className="tc-btn--ghost" style={{ padding: 2, color: 'var(--gray-400)' }}>
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Product selector */}
              <div>
                <label className="tc-label"><Package size={14} /> {es.quote.addItem}</label>
                <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                  <input
                    className="tc-input"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder={es.quote.selectProduct}
                    style={{ flex: 1 }}
                  />
                  <select className="tc-input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ width: 180 }}>
                    <option value="">{es.inventory.category}</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                {productSearch && filteredProducts.length > 0 && (
                  <div style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', maxHeight: 200, overflow: 'auto' }}>
                    {filterProducts(filteredProducts, productSearch).slice(0, 20).map((p) => (
                      <div
                        key={p.id}
                        onClick={() => addItemToForm(p)}
                        style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', borderBottom: '1px solid var(--gray-100)' }}
                      >
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                        <span style={{ color: 'var(--gray-500)' }}>{formatCurrency(p.price)} · Stock: {p.stock}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Items table */}
              {formItems.length > 0 && (
                <div className="tc-table-wrap">
                  <table className="tc-table">
                    <thead>
                      <tr>
                        <th>{es.quote.product}</th>
                        <th style={{ width: 80 }}>{es.quote.quantity}</th>
                        <th style={{ width: 100 }}>{es.quote.price}</th>
                        <th style={{ width: 80 }}>{es.quote.discount}</th>
                        <th style={{ width: 100 }}>{es.quote.lineTotal}</th>
                        <th style={{ width: 40 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formItems.map((item) => (
                        <tr key={item.productId}>
                          <td style={{ fontWeight: 600, color: 'var(--gray-900)' }}>{item.productName}</td>
                          <td>
                            <input
                              type="number" min="1"
                              className="tc-input"
                              value={item.quantity}
                              onChange={(e) => setFormItems(formItems.map((i) => i.productId === item.productId ? { ...i, quantity: Number(e.target.value) || 1 } : i))}
                              style={{ width: 60, minHeight: 32, padding: '4px 8px' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number" step="0.01" min="0"
                              className="tc-input"
                              value={item.unitPrice}
                              onChange={(e) => setFormItems(formItems.map((i) => i.productId === item.productId ? { ...i, unitPrice: Number(e.target.value) || 0 } : i))}
                              style={{ width: 90, minHeight: 32, padding: '4px 8px' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number" step="0.01" min="0"
                              className="tc-input"
                              value={item.discount}
                              onChange={(e) => setFormItems(formItems.map((i) => i.productId === item.productId ? { ...i, discount: Number(e.target.value) || 0 } : i))}
                              style={{ width: 70, minHeight: 32, padding: '4px 8px' }}
                            />
                          </td>
                          <td style={{ fontWeight: 700, color: 'var(--gray-900)' }}>
                            {formatCurrency(item.unitPrice * item.quantity - item.discount)}
                          </td>
                          <td>
                            <button type="button" onClick={() => removeFormItem(item.productId)} className="tc-btn--ghost" style={{ color: 'var(--red-500)', padding: 4 }}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals & adjustments */}
              <div style={{ display: 'flex', gap: 'var(--space-6)', justifyContent: 'flex-end', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="tc-field" style={{ width: 160 }}>
                  <label className="tc-label">{es.quote.deliveryFee}</label>
                  <input type="number" step="0.01" min="0" className="tc-input" value={formDelivery} onChange={(e) => setFormDelivery(Number(e.target.value) || 0)} placeholder={es.quote.deliveryFeePlaceholder} />
                </div>
                <div className="tc-field" style={{ width: 160 }}>
                  <label className="tc-label">{es.quote.globalDiscount}</label>
                  <input type="number" step="0.01" min="0" className="tc-input" value={formDiscount} onChange={(e) => setFormDiscount(Number(e.target.value) || 0)} placeholder={es.quote.globalDiscountPlaceholder} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)' }}>{es.quote.subtotal}</div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--gray-700)' }}>{formatCurrency(calcSubtotal)}</div>
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--brand-600)', marginTop: 4 }}>{formatCurrency(calcTotal)}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: 'var(--space-4) var(--space-6)', borderTop: '1px solid var(--border-light)', background: 'var(--gray-50)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
              <button type="button" onClick={resetForm} className="tc-btn tc-btn--secondary">{es.common.cancel}</button>
              <LoadingButton onClick={handleSave} loading={saving} disabled={formItems.length === 0} className="tc-btn tc-btn--primary">
                {editingId ? es.common.save : es.quote.newQuote}
              </LoadingButton>
            </div>
          </div>
        </div>
      )}

      {/* Convert to Sale Modal */}
      {convertQuote && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-6)',
        }}>
          <div style={{
            background: '#fff', borderRadius: 'var(--radius-xl)', width: '100%', maxWidth: 480,
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)', padding: 'var(--space-6)',
          }}>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--gray-900)', marginBottom: 'var(--space-4)' }}>
              {es.quote.convertToSale} — {convertQuote.saleNumber}
            </h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--gray-500)', marginBottom: 'var(--space-4)' }}>
              Total: <strong style={{ color: 'var(--gray-900)' }}>{formatCurrency(convertQuote.total)}</strong>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {convertPayments.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <select className="tc-input" value={p.method} onChange={(e) => setConvertPayments(convertPayments.map((pp, j) => j === i ? { ...pp, method: e.target.value as PaymentMethod } : pp))} style={{ flex: 1 }}>
                    {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <input type="number" step="0.01" min="0" className="tc-input" value={p.amount} onChange={(e) => setConvertPayments(convertPayments.map((pp, j) => j === i ? { ...pp, amount: Number(e.target.value) || 0 } : pp))} style={{ width: 120 }} placeholder="Monto" />
                  <input type="text" className="tc-input" value={p.reference} onChange={(e) => setConvertPayments(convertPayments.map((pp, j) => j === i ? { ...pp, reference: e.target.value } : pp))} style={{ width: 100 }} placeholder="Ref." />
                  <button type="button" onClick={() => setConvertPayments(convertPayments.filter((_, j) => j !== i))} className="tc-btn--ghost" style={{ color: 'var(--red-500)', padding: 4 }}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setConvertPayments([...convertPayments, { method: 'efectivo' as PaymentMethod, amount: 0, reference: '' }])}
                className="tc-btn tc-btn--secondary" style={{ alignSelf: 'flex-start' }}
              >
                + {es.sales.addPayment}
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
              <button type="button" onClick={() => { setConvertQuote(null); setConvertPayments([]); }} className="tc-btn tc-btn--secondary">{es.common.cancel}</button>
              <LoadingButton onClick={handleConvertToSale} loading={converting} disabled={convertPayments.length === 0 || convertPayments.reduce((s, p) => s + p.amount, 0) < convertQuote.total} className="tc-btn tc-btn--primary">
                <ShoppingCart size={16} /> {es.quote.createAsSale}
              </LoadingButton>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={es.quote.deleteQuote}
        message={es.quote.deleteConfirm.replace('{saleNumber}', deleteTarget?.saleNumber ?? '')}
        confirmLabel={es.common.delete}
        onConfirm={handleDelete}
        loading={deleting}
        variant="danger"
      />

      {/* Quotes List */}
      {quotes.length === 0 ? (
        <Card>
          <EmptyState icon={FileText} title={es.quote.noQuotes} />
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          {quotes.map((quote) => (
            <Card key={quote.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flex: 1, minWidth: 0 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 'var(--radius-lg)',
                    background: 'var(--brand-50)', color: 'var(--brand-600)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <FileText size={20} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--gray-900)', fontSize: 'var(--text-base)' }}>{quote.saleNumber}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)', marginTop: 2 }}>
                      {formatDateTime(quote.createdAt)}
                    </div>
                  </div>
                  <div style={{ color: 'var(--gray-500)', fontSize: 'var(--text-sm)' }}>
                    {quote.customer?.name ?? <span style={{ color: 'var(--gray-300)' }}>{es.quote.selectCustomer}</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)' }}>{es.quote.items}</div>
                    <div style={{ fontWeight: 600, color: 'var(--gray-700)', fontSize: 'var(--text-sm)' }}>
                      <Package size={12} style={{ display: 'inline', marginRight: 4 }} />
                      {quote.items.length}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)' }}>{es.quote.total}</div>
                    <div style={{ fontWeight: 800, color: 'var(--brand-600)', fontSize: 'var(--text-lg)' }}>{formatCurrency(quote.total)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button type="button" onClick={() => openEditForm(quote)} className="tc-btn tc-btn--secondary" style={{ padding: '6px 12px', fontSize: 'var(--text-sm)' }}>
                      {es.common.edit}
                    </button>
                    <button type="button" onClick={() => setDeleteTarget(quote)} className="tc-btn tc-btn--danger" style={{ padding: '6px 12px', fontSize: 'var(--text-sm)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setConvertQuote(quote)}
                  className="tc-btn tc-btn--primary"
                  style={{ padding: '6px 12px', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}
                  title={es.quote.convertToSale}
                >
                  <ShoppingCart size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function filterProducts(products: Product[], search: string): Product[] {
  if (!search) return products;
  const term = search.toLowerCase();
  return products.filter(
    (p) => p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term),
  );
}
