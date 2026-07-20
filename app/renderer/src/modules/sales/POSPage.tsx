import { useEffect, useMemo, useState, useCallback, memo } from 'react';
import {
  Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, User, X, Check,
  Banknote, Smartphone, Navigation, Tag, Truck, Percent, AlertCircle, RefreshCw,
  ArrowRight, History, ScanLine, CheckCircle2, DollarSign,
} from 'lucide-react';

import { useNavigate } from 'react-router-dom';
import { trpc } from '../../trpc';
import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useAuth } from '../../shared/context/AuthContext';
import { formatCurrency } from '../../shared/utils/formatters';
import { useBarcodeScanner } from '../../shared/hooks/useBarcodeScanner';
import type { Product } from '../../shared/types/inventory.types';
import type { CashRegister } from '../../shared/types/cash.types';
import type { PaymentInput, PaymentMethod, CartItemInput, SaleRecord } from '../../shared/types/sales.types';

interface Customer {
  id: number;
  name: string;
  fullName?: string;
  phone: string | null;
  email?: string | null;
}

interface CartItem {
  product: Product;
  quantity: number;
  unitPrice: number;
  discount: number;
}

const ProductCard = memo(function ProductCard({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: (product: Product) => void;
}): JSX.Element {
  const outOfStock = product.stock <= 0;
  return (
    <div
      role="button"
      tabIndex={outOfStock ? -1 : 0}
      onClick={() => !outOfStock && onAdd(product)}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !outOfStock) { e.preventDefault(); onAdd(product); } }}
      aria-label={`${product.name}, ${formatCurrency(product.price)}, ${outOfStock ? 'Sin stock' : `Stock: ${product.stock}`}`}
      className="tc-card animate-slideUp group"
      style={{
        cursor: outOfStock ? 'not-allowed' : 'pointer',
        opacity: outOfStock ? 0.55 : 1,
        border: '2px solid transparent',
        transition: 'all 0.2s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        if (outOfStock) return;
        e.currentTarget.style.borderColor = 'var(--brand-300)';
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'transparent';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-card)';
      }}
    >
      {outOfStock && (
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'repeating-linear-gradient(45deg, transparent, transparent 6px, rgba(0,0,0,0.03) 6px, rgba(0,0,0,0.03) 12px)',
            borderRadius: 'inherit', pointerEvents: 'none',
          }}
        />
      )}
      <div style={{ padding: 'var(--space-4)' }}>
        <p style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {product.category?.name || 'Varios'}
        </p>
        <h4 style={{ fontWeight: 700, color: outOfStock ? 'var(--gray-400)' : 'var(--gray-800)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {product.name}
        </h4>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: outOfStock ? 'var(--gray-400)' : 'var(--brand-600)', fontWeight: 800, fontSize: 'var(--text-base)' }}>
            {formatCurrency(product.price)}
          </span>
          <span className={`tc-badge ${outOfStock ? 'tc-badge--danger' : product.stock > 10 ? 'tc-badge--success' : 'tc-badge--danger'}`}>
            {outOfStock ? 'Sin stock' : `Stock: ${product.stock}`}
          </span>
        </div>
      </div>
    </div>
  );
});

export function POSPage(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeCash, setActiveCash] = useState<CashRegister | null>(null);
  const [cashLoadError, setCashLoadError] = useState<string | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [payments, setPayments] = useState<PaymentInput[]>([]);

  const [cashReceived, setCashReceived] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  type PaymentStep = 'options' | 'cash' | 'mixed-step-1' | 'mixed-step-2';
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('options');
  const [mixtoCashAmount, setMixtoCashAmount] = useState(0);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [modalError, setModalError] = useState<string | null>(null);
  const [businessConfig, setBusinessConfig] = useState<any>(null);

  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<Customer[]>([]);
  const [customerCreateName, setCustomerCreateName] = useState('');
  const [customerCreatePhone, setCustomerCreatePhone] = useState('');

  const addToCart = useCallback((product: Product): void => {
    if (product.stock <= 0) {
      setMessageType('error');
      setMessage(`"${product.name}" no tiene stock disponible.`);
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...prev, { product, quantity: 1, unitPrice: product.price, discount: 0 }];
    });
  }, []);

  const updateCartQty = (productId: number, delta: number): void => {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? { ...item, quantity: Math.max(1, item.quantity + delta) }
          : item,
      ),
    );
  };

  const removeFromCart = (productId: number): void => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const clearCart = (): void => {
    setCart([]);
    setPayments([]);
    setDeliveryFee(0);
    setGlobalDiscount(0);
    setSelectedCustomerId(null);
    setCashReceived(0);
    setPaymentStep('options');
    setSelectedMethod(null);
    setShowCheckoutModal(false);
    setModalError(null);
  };

  // Barcode scanner integration
  const scanner = useBarcodeScanner({
    onDetect: (barcode) => {
      setSearchTerm(barcode);
    },
    enabled: !showCheckoutModal,
  });

  useEffect(() => {
    if (scanner.product) {
      addToCart(scanner.product);
      setMessageType('success');
      setMessage(`${scanner.product.name} agregado (código de barras)`);
      setTimeout(() => setMessage(''), 2500);
      scanner.reset();
    }
  }, [scanner.product, addToCart, scanner]);

  useEffect(() => {
    if (scanner.error) {
      setMessageType('error');
      setMessage(scanner.error);
      setTimeout(() => setMessage(''), 3000);
      scanner.reset();
    }
  }, [scanner.error, scanner]);

  // Load initial data
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadData = async (): Promise<void> => {
      try {
        setCashLoadError(null);

        const [cashResult, productsResult, configResult] = await Promise.all([
          trpc.cash.getActive.query({ userId: user.id }),
          trpc.inventory.getAll.query({}),
          trpc.config.getBusiness.query(),
        ]);

        if (cancelled) return;

        if (cashResult) {
          setActiveCash(cashResult as CashRegister);
          setCashLoadError(null);
        } else {
          setActiveCash(null);
          setCashLoadError('No se detectó una caja abierta');
        }

        const productsData = productsResult as { products: Product[]; total: number };
        if (productsData?.products) {
          setProducts(productsData.products.filter((p) => p.isActive));
        }

        if (configResult) {
          setBusinessConfig(configResult);
        }
      } catch {
        if (!cancelled) setCashLoadError('Error de conexión al cargar datos');
      }
    };

    void loadData();
    return () => { cancelled = true; };
  }, [user]);

  // Customer search
  useEffect(() => {
    if (!customerSearchTerm || customerSearchTerm.length < 2) {
      setCustomerSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await trpc.customers.search.query({ query: customerSearchTerm });
        setCustomerSearchResults(result as Customer[]);
      } catch {
        setCustomerSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearchTerm]);

  const handleCreateCustomer = async (): Promise<void> => {
    if (!customerCreateName.trim()) return;
    try {
      const result = await trpc.customers.create.mutate({
        data: {
          name: customerCreateName.trim(),
          phone: customerCreatePhone.trim() || undefined,
        },
      });
      const newCustomer = result as Customer;
      setCustomers((prev) => [...prev, newCustomer]);
      setSelectedCustomerId(newCustomer.id);
      setShowCustomerModal(false);
      setCustomerCreateName('');
      setCustomerCreatePhone('');
      setMessageType('success');
      setMessage(`Cliente "${newCustomer.name}" creado.`);
      setTimeout(() => setMessage(''), 3000);
    } catch {
      setMessageType('error');
      setMessage('Error al crear cliente.');
      setTimeout(() => setMessage(''), 3000);
    }
  };

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const filteredProducts = useMemo(() => {
    if (!debouncedSearch) return products.slice(0, 40);
    const lower = debouncedSearch.toLowerCase();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(lower) ||
          p.code.toLowerCase().includes(lower) ||
          p.barcode?.toLowerCase().includes(lower),
      )
      .slice(0, 40);
  }, [products, debouncedSearch]);

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity * item.unitPrice - item.discount, 0),
    [cart],
  );

  const ivaEnabled = businessConfig?.ivaEnabled ?? false;

  const tax = useMemo(
    () => {
      if (!ivaEnabled) return 0;
      return cart.reduce((sum, item) => {
        return sum + (item.quantity * item.unitPrice - item.discount) * (item.product.taxRate || 0);
      }, 0);
    },
    [cart, ivaEnabled],
  );

  const calculatedDiscount = useMemo(
    () => (discountType === 'percentage' ? (subtotal * globalDiscount) / 100 : globalDiscount),
    [subtotal, globalDiscount, discountType],
  );

  const total = subtotal + tax + deliveryFee - calculatedDiscount;
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = total - totalPaid;

  const refreshCashState = async (): Promise<void> => {
    if (!user) return;
    try {
      setCashLoadError(null);
      const result = await trpc.cash.getActive.query({ userId: user.id });
      if (result) {
        setActiveCash(result as CashRegister);
        setCashLoadError(null);
      } else {
        setActiveCash(null);
        setCashLoadError('No se detectó una caja abierta');
      }
    } catch {
      setCashLoadError('Error de conexión al verificar la caja');
    }
  };

  const refreshProducts = async (): Promise<void> => {
    try {
      const result = await trpc.inventory.getAll.query({});
      const data = result as { products: Product[]; total: number };
      if (data?.products) setProducts(data.products.filter((p) => p.isActive));
    } catch (err) {
      rendererLogger.error('POSPage', 'Error al refrescar productos:', err);
    }
  };

  // --- Payment flow ---
  const addPayment = (method: PaymentMethod): void => {
    if (remaining <= 0.1) return;
    if (method === 'credito' && !selectedCustomerId) {
      setMessageType('error');
      setMessage('Seleccione un cliente para realizar una venta a crédito.');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    if (method === 'credito') {
      setPayments((prev) => [...prev, { method, amount: remaining }]);
      return;
    }
    if (method === 'efectivo') {
      setSelectedMethod(method);
      setPaymentStep('cash');
      return;
    }
    setPayments((prev) => [...prev, { method, amount: remaining }]);
  };

  const confirmCashPayment = async (): Promise<void> => {
    if (!selectedMethod || cashReceived < remaining) {
      setMessageType('error');
      setMessage(`El monto recibido debe ser al menos ${formatCurrency(remaining)}`);
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    const change = cashReceived - remaining;
    setPayments((prev) => [...prev, { method: selectedMethod, amount: cashReceived }]);
    setPaymentStep('options');
    setCashReceived(0);
    setSelectedMethod(null);
    if (change > 0) {
      setMessageType('success');
      setMessage(`Cambio a devolver: ${formatCurrency(change)}`);
      setTimeout(() => setMessage(''), 4000);
    }
  };

  const confirmMixtoCash = (): void => {
    if (mixtoCashAmount <= 0) {
      setMessageType('error');
      setMessage('Ingrese un monto mayor a $0');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    if (mixtoCashAmount >= total) {
      setMessageType('error');
      setMessage('Para pagar todo, use "Efectivo" directamente');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    setPaymentStep('mixed-step-2');
  };

  const addMixtoSecondPayment = (method: PaymentMethod): void => {
    const finalPayments: PaymentInput[] = [
      { method: 'efectivo', amount: mixtoCashAmount },
      { method, amount: total - mixtoCashAmount },
    ];
    setPaymentStep('options');
    setMixtoCashAmount(0);
    setPayments(finalPayments);
    void processCompleteSale(finalPayments, false);
  };

  const handleCompleteSale = async (): Promise<void> => {
    if (remaining > 0.1) {
      setMessageType('error');
      setMessage(`Falta cubrir un saldo de ${formatCurrency(remaining)}`);
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    const hasCredit = payments.some((p) => p.method === 'credito');
    if (hasCredit && selectedCustomerId) {
      await processCreditSale();
    } else {
      await processCompleteSale(payments, false);
    }
  };

  const processCreditSale = async (): Promise<void> => {
    if (!user || !activeCash || cart.length === 0 || !selectedCustomerId) return;
    setLoading(true);
    try {
      const items: CartItemInput[] = cart.map((i) => ({
        productId: i.product.id,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discount: i.discount,
      }));
      const result = await trpc.sales.create.mutate({
        cashSessionId: activeCash.id,
        userId: user.id,
        items,
        payments: [],
        discount: globalDiscount,
        deliveryFee,
        customerId: selectedCustomerId ?? undefined,
        isCreditSale: true,
        discountType,
      });
      const sale = result as SaleRecord;
      setMessageType('success');
      setMessage(`Venta a crédito #${sale.saleNumber} registrada - Cuenta por cobrar: ${formatCurrency(total)}`);
      clearCart();
      void refreshProducts();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al procesar');
    } finally {
      setLoading(false);
    }
    setTimeout(() => setMessage(''), 4000);
  };

  const processCompleteSale = async (finalPayments: PaymentInput[], isCreditSale = false): Promise<void> => {
    if (!user || !activeCash || cart.length === 0) return;
    setLoading(true);
    try {
      const items: CartItemInput[] = cart.map((i) => ({
        productId: i.product.id,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discount: i.discount,
      }));
      const result = await trpc.sales.create.mutate({
        cashSessionId: activeCash.id,
        userId: user.id,
        items,
        payments: finalPayments,
        discount: globalDiscount,
        deliveryFee,
        customerId: selectedCustomerId ?? undefined,
        isCreditSale,
        discountType,
      });
      const sale = result as SaleRecord;
      const totalPaidFinal = finalPayments.reduce((s, p) => s + p.amount, 0);
      const change = totalPaidFinal > sale.total ? totalPaidFinal - sale.total : 0;
      const changeMsg = change > 0 ? ` (Cambio: ${formatCurrency(change)})` : '';
      setMessageType('success');
      setMessage(`Venta #${sale.saleNumber} completada${changeMsg}`);
      clearCart();
      void refreshProducts();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Error al procesar');
    } finally {
      setLoading(false);
    }
    setTimeout(() => setMessage(''), 4000);
  };

  // --- No active cash state ---
  if (!activeCash) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', gap: 'var(--space-6)', animation: 'fadeIn 0.5s ease' }}>
        <div className="tc-metric-icon tc-metric-icon--danger" style={{ width: '96px', height: '96px', borderRadius: 'var(--radius-3xl)' }}>
          <AlertCircle size={48} />
        </div>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <h2 className="tc-metric-value" style={{ marginBottom: 'var(--space-2)' }}>Caja Cerrada</h2>
          <p style={{ color: 'var(--gray-500)', fontWeight: 500, lineHeight: 1.6 }}>
            Debe iniciar una sesión de caja para poder realizar ventas en este terminal.
          </p>
          {cashLoadError && (
            <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', color: '#dc2626', fontSize: 'var(--text-sm)' }}>
              {cashLoadError}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={refreshCashState} className="tc-btn tc-btn--secondary" style={{ padding: '0 var(--space-6)', minHeight: '48px', fontSize: 'var(--text-base)' }}>
            <RefreshCw size={18} style={{ marginRight: 'var(--space-2)' }} />
            Refrescar Estado
          </button>
          <button onClick={() => navigate('/cash')} className="tc-btn tc-btn--primary" style={{ padding: '0 var(--space-8)', minHeight: '56px', fontSize: 'var(--text-lg)', boxShadow: 'var(--shadow-xl)' }}>
            <ArrowRight size={20} />
            Ir a Control de Caja
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: '1700px', margin: '0 auto', overflow: 'hidden', animation: 'fadeIn 0.3s ease' }}>
      {/* Message banner */}
      {message && (
        <div className={`tc-notice tc-notice--${messageType === 'success' ? 'success' : messageType === 'error' ? 'error' : 'info'}`}
          role="alert" aria-live="assertive"
          style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', animation: 'slideDown 0.3s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {messageType === 'success' ? <CheckCircle2 size={18} /> : messageType === 'error' ? <AlertCircle size={18} /> : <ScanLine size={18} />}
            <span style={{ fontWeight: 600 }}>{message}</span>
          </div>
          <button onClick={() => setMessage('')} aria-label="Cerrar mensaje" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.6, padding: '4px', display: 'flex' }}>
            <X size={16} />
          </button>
        </div>
      )}

      <div className="pos-grid" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--space-4)', height: 'calc(100vh - 140px)', minHeight: 0 }}>
        {/* === LEFT COLUMN === */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 0, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ animation: 'slideDown 0.4s ease', background: 'linear-gradient(135deg, var(--brand-600) 0%, var(--brand-500) 100%)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-4) var(--space-5)', boxShadow: '0 4px 12px rgba(54, 65, 245, 0.2)', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)' }}>
              <div>
                <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-3)', color: '#fff', fontSize: 'var(--text-lg)', fontWeight: 800 }}>
                  <ShoppingCart size={24} />
                  Punto de Venta
                </h1>
                <p style={{ margin: '2px 0 0', color: 'rgba(255,255,255,0.85)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                  Caja #{activeCash.id} &middot; {activeCash.openedAt ? new Date(activeCash.openedAt).toLocaleDateString() : ''}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', padding: '4px 12px', borderRadius: 'var(--radius-full)', fontWeight: 700, fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <ScanLine size={12} />
                  POS Activo
                </span>
                <button onClick={() => navigate('/sales/history')} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-lg)', fontWeight: 600, fontSize: 'var(--text-xs)', cursor: 'pointer', transition: 'all var(--transition-fast)' }}>
                  <History size={16} />
                  Historial
                </button>
              </div>
            </div>
          </div>

          {/* Search */}
          <div style={{ padding: 'var(--space-4)', flexShrink: 0, background: 'linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%)', borderRadius: 'var(--radius-xl)', border: '2px solid var(--brand-100)', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search style={{ position: 'absolute', left: 'var(--space-4)', top: '50%', transform: 'translateY(-50%)', color: 'var(--brand-500)', pointerEvents: 'none' }} size={20} />
                <input
                  type="text"
                  placeholder="Buscar producto por nombre, código o código de barras..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="tc-input"
                  style={{ paddingLeft: '48px', paddingRight: '48px', minHeight: '52px', fontSize: '18px', background: '#ffffff', color: 'var(--gray-900)', border: '2px solid var(--brand-100)', boxShadow: 'var(--shadow-sm)', fontWeight: 500 }}
                  autoFocus
                  aria-label="Buscar producto"
                />
                {searchTerm && (
                  <button onClick={() => setSearchTerm('')} style={{ position: 'absolute', right: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--gray-400)', cursor: 'pointer', padding: 'var(--space-2)' }}>
                    <X size={18} />
                  </button>
                )}
              </div>
              <div
                title={scanner.isScanning ? 'Escáner detectado...' : 'Escáner de código de barras'}
                style={{
                  width: 52, height: 52, borderRadius: 'var(--radius-lg)',
                  background: scanner.isScanning ? 'var(--success)' : 'var(--gray-100)',
                  color: scanner.isScanning ? '#fff' : 'var(--gray-400)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'all var(--transition-fast)',
                  animation: scanner.isScanning ? 'pulse 0.8s ease-in-out infinite' : 'none',
                }}
              >
                <ScanLine size={24} />
              </div>
            </div>
          </div>

          {/* Products Grid */}
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: 'var(--space-2)', minHeight: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
              {filteredProducts.map((product) => (
                <ProductCard key={product.id} product={product} onAdd={addToCart} />
              ))}
            </div>
          </div>
        </div>

        {/* === RIGHT COLUMN - Cart === */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          <div className="tc-card" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', height: 'auto', border: '2px solid var(--brand-100)', boxShadow: 'var(--shadow-xl)', padding: 0, animation: 'slideInRight 0.4s ease' }}>
            {/* Cart Header */}
            <div style={{ padding: 'var(--space-4)', background: 'linear-gradient(135deg, var(--brand-600) 0%, var(--brand-500) 100%)', borderBottom: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(54, 65, 245, 0.2)' }}>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 'var(--text-lg)', color: '#fff', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <ShoppingCart size={22} />
                Carrito de Venta
              </h3>
              {cart.length > 0 && (
                <span style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', padding: '4px 12px', borderRadius: 'var(--radius-full)', fontWeight: 700, fontSize: 'var(--text-xs)' }}>
                  {cart.reduce((sum, item) => sum + item.quantity, 0)} items
                </span>
              )}
            </div>

            {/* Customer Picker */}
            <div style={{ padding: 'var(--space-3)', background: 'linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%)', borderBottom: '2px solid var(--brand-100)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <User style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} size={16} />
                  <input
                    type="text"
                    placeholder="Buscar cliente..."
                    value={customerSearchTerm}
                    onChange={(e) => setCustomerSearchTerm(e.target.value)}
                    onFocus={() => setShowCustomerModal(true)}
                    className="tc-input"
                    style={{ paddingLeft: '40px', minHeight: '44px', fontWeight: 700, fontSize: 'var(--text-sm)', cursor: 'pointer' }}
                    readOnly
                    aria-label="Buscar cliente"
                  />
                </div>
                <button onClick={() => setShowCustomerModal(true)} className="tc-btn tc-btn--secondary" aria-label="Seleccionar cliente" style={{ padding: '0 var(--space-3)', minHeight: '44px' }}>
                  <User size={20} />
                </button>
              </div>
              {selectedCustomerId && (
                <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span className="tc-badge tc-badge--info" style={{ fontSize: 'var(--text-xs)' }}>
                    {customers.find((c) => c.id === selectedCustomerId)?.name || `Cliente #${selectedCustomerId}`}
                  </span>
                  <button onClick={() => setSelectedCustomerId(null)} style={{ background: 'none', border: 'none', color: 'var(--gray-400)', cursor: 'pointer', padding: '2px' }}>
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Cart Items */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', background: 'var(--gray-50)', minHeight: '200px' }}>
              {cart.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {cart.map((item, idx) => (
                    <div key={item.product.id} className="animate-slideUp" style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', background: '#fff', padding: 'var(--space-3)', borderRadius: 'var(--radius-xl)', borderLeft: '4px solid var(--brand-500)', borderRight: '1px solid var(--gray-200)', borderTop: '1px solid var(--gray-200)', borderBottom: '1px solid var(--gray-200)', boxShadow: 'var(--shadow-xs)', animationDelay: `${idx * 50}ms` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h5 style={{ fontWeight: 700, color: 'var(--gray-800)', fontSize: 'var(--text-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '4px' }}>
                          {item.product.name}
                        </h5>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <span style={{ color: 'var(--brand-600)', fontWeight: 800, fontSize: 'var(--text-sm)' }}>
                            {formatCurrency(item.unitPrice)}
                          </span>
                          {item.discount > 0 && (
                            <span className="tc-badge tc-badge--warning" style={{ fontSize: 'var(--text-xs)', padding: '2px 6px' }}>
                              -{formatCurrency(item.discount)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                        <button onClick={() => updateCartQty(item.product.id, -1)} aria-label={`Reducir cantidad de ${item.product.name}`} style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', background: 'var(--gray-100)', border: '1px solid var(--gray-200)', color: 'var(--gray-600)', cursor: 'pointer' }}>
                          <Minus size={14} aria-hidden="true" />
                        </button>
                        <span aria-label={`Cantidad: ${item.quantity}`} style={{ fontWeight: 800, fontSize: 'var(--text-base)', minWidth: '24px', textAlign: 'center' }}>{item.quantity}</span>
                        <button onClick={() => updateCartQty(item.product.id, 1)} aria-label={`Aumentar cantidad de ${item.product.name}`} style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', background: 'var(--brand-100)', border: '1px solid var(--brand-200)', color: 'var(--brand-600)', cursor: 'pointer' }}>
                          <Plus size={14} aria-hidden="true" />
                        </button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ fontWeight: 800, color: 'var(--gray-900)', fontSize: 'var(--text-base)' }}>
                          {formatCurrency(item.quantity * item.unitPrice - item.discount)}
                        </span>
                        <button onClick={() => removeFromCart(item.product.id)} aria-label={`Eliminar ${item.product.name} del carrito`} style={{ width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger-400)', borderRadius: 'var(--radius-md)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #f8f9ff 0%, #f0f4ff 100%)', gap: 'var(--space-3)', padding: 'var(--space-10)' }}>
                  <div style={{ width: '64px', height: '64px', borderRadius: 'var(--radius-2xl)', background: 'var(--brand-100)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ShoppingCart size={32} style={{ color: 'var(--brand-400)' }} />
                  </div>
                  <p style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--brand-700)' }}>Carrito Vacío</p>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--brand-500)', textAlign: 'center' }}>Haga clic en un producto para agregarlo</p>
                </div>
              )}
            </div>

            {/* Payment Panel */}
            <div style={{ padding: 'var(--space-4)', background: 'linear-gradient(180deg, #fff 0%, #f8f9ff 100%)', borderTop: '2px solid var(--brand-200)' }}>
              {/* Totals */}
              <div style={{ background: 'linear-gradient(135deg, var(--gray-50) 0%, #f0f4ff 100%)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)', border: '2px solid var(--brand-100)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-600)' }}>Subtotal</span>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--gray-800)' }}>{formatCurrency(subtotal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-600)' }}>IVA</span>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--gray-800)' }}>{formatCurrency(tax)}</span>
                  </div>
                  {globalDiscount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-600)' }}>Descuento ({discountType === 'percentage' ? `${globalDiscount}%` : 'FIJO'})</span>
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--success-600)' }}>-{formatCurrency(calculatedDiscount)}</span>
                    </div>
                  )}
                  {deliveryFee > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-600)' }}>Delivery</span>
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--gray-800)' }}>{formatCurrency(deliveryFee)}</span>
                    </div>
                  )}
                  {/* Payment progress */}
                  {payments.length > 0 && (
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--success-700)' }}>Pagado: {formatCurrency(totalPaid)}</span>
                        <span style={{ fontWeight: 600, color: remaining > 0.1 ? 'var(--warning-600)' : 'var(--success-700)' }}>
                          {remaining > 0.1 ? `Falta: ${formatCurrency(remaining)}` : 'Cubierto'}
                        </span>
                      </div>
                      <div style={{ height: '6px', background: 'var(--gray-200)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, (totalPaid / total) * 100)}%`, background: remaining > 0.1 ? 'var(--warning-400)' : 'var(--success-500)', borderRadius: 'var(--radius-full)', transition: 'width 0.3s ease' }} />
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
                        {payments.map((p, idx) => (
                          <span key={idx} className="tc-badge tc-badge--success" style={{ fontSize: 'var(--text-xs)', padding: '2px 6px' }}>
                            {p.method} {formatCurrency(p.amount)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ borderTop: '2px solid var(--brand-200)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, var(--brand-50) 0%, #e8edff 100%)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', margin: '0 calc(-1 * var(--space-3))' }}>
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 800, color: 'var(--brand-700)', textTransform: 'uppercase' }}>Total a Pagar</span>
                    <span style={{ fontSize: 'var(--text-xl)', fontWeight: 900, color: 'var(--brand-600)' }}>{formatCurrency(total)}</span>
                  </div>
                </div>
              </div>

              {/* Delivery & Discount */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <div style={{ position: 'relative' }}>
                  <Truck style={{ position: 'absolute', left: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} size={12} />
                  <input type="number" placeholder="Delivery" value={deliveryFee || ''} onChange={(e) => setDeliveryFee(Number(e.target.value))} className="tc-input" style={{ paddingLeft: '28px', minHeight: '34px', fontSize: 'var(--text-xs)', background: '#fff' }} aria-label="Costo de envío" />
                </div>
                <div style={{ position: 'relative', display: 'flex', gap: 'var(--space-1)' }}>
                  {discountType === 'percentage' ? <Percent style={{ position: 'absolute', left: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} size={12} /> : <DollarSign style={{ position: 'absolute', left: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)', pointerEvents: 'none' }} size={12} />}
                  <input type="number" placeholder="Descuento" value={globalDiscount || ''} onChange={(e) => setGlobalDiscount(Number(e.target.value))} className="tc-input" style={{ paddingLeft: '28px', minHeight: '34px', fontSize: 'var(--text-xs)', background: '#fff', width: '70px' }} aria-label="Descuento" />
                  <button type="button" onClick={() => setDiscountType(discountType === 'percentage' ? 'fixed' : 'percentage')} aria-label={`Cambiar tipo de descuento: ${discountType === 'percentage' ? 'porcentaje' : 'fijo'}`} style={{ minHeight: '34px', padding: '0 var(--space-2)', border: '1px solid var(--gray-300)', borderRadius: 'var(--radius-md)', background: 'var(--gray-100)', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                    {discountType === 'percentage' ? '%' : '$'}
                  </button>
                </div>
              </div>

              {/* Cobrar Button */}
              <button
                onClick={() => { setShowCheckoutModal(true); setPaymentStep('options'); setPayments([]); setCashReceived(0); setMixtoCashAmount(0); setModalError(null); }}
                disabled={cart.length === 0 || showCheckoutModal}
                aria-label={`Cobrar ${formatCurrency(total)}`}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)', borderRadius: 'var(--radius-xl)', background: cart.length > 0 && !showCheckoutModal ? 'linear-gradient(135deg, var(--success-600) 0%, var(--success-500) 100%)' : 'var(--gray-300)', border: 'none', color: '#fff', fontWeight: 800, fontSize: 'var(--text-lg)', cursor: cart.length === 0 || showCheckoutModal ? 'not-allowed' : 'pointer', opacity: cart.length === 0 || showCheckoutModal ? 0.5 : 1, transition: 'all var(--transition-fast)', boxShadow: cart.length > 0 && !showCheckoutModal ? '0 4px 16px rgba(18, 183, 106, 0.5)' : 'none', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-2)', minHeight: '56px' }}
              >
                <Banknote size={24} />
                <span>COBRAR {formatCurrency(total)}</span>
              </button>

              {/* Clear Cart */}
              <button onClick={clearCart} disabled={cart.length === 0} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', padding: 'var(--space-2)', borderRadius: 'var(--radius-lg)', background: 'transparent', border: '1px solid var(--gray-200)', color: 'var(--gray-500)', fontWeight: 600, fontSize: 'var(--text-xs)', cursor: cart.length === 0 ? 'not-allowed' : 'pointer', opacity: cart.length === 0 ? 0.4 : 1, transition: 'all var(--transition-fast)' }}>
                <X size={14} />
                Limpiar carrito
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CHECKOUT MODAL */}
      {showCheckoutModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowCheckoutModal(false); setPayments([]); setPaymentStep('options'); setCashReceived(0); setMixtoCashAmount(0); setModalError(null); } }}>
          <div style={{ background: 'var(--gray-50)', borderRadius: 'var(--radius-2xl)', width: '95vw', maxWidth: '900px', maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
            {/* Modal Header */}
            <div style={{ padding: 'var(--space-4)', background: 'linear-gradient(135deg, var(--brand-600) 0%, var(--brand-500) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontWeight: 800, fontSize: 'var(--text-xl)', color: '#fff', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <Banknote size={28} />
                Cobro - Total: {formatCurrency(total)}
              </h2>
              <button onClick={() => { setShowCheckoutModal(false); setPayments([]); setPaymentStep('options'); setCashReceived(0); setMixtoCashAmount(0); setModalError(null); }} style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-lg)', background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={20} />
              </button>
            </div>

            {modalError && (
              <div style={{ margin: 'var(--space-4) var(--space-4) 0', padding: 'var(--space-3)', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'space-between', animation: 'slideDown 0.3s ease' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <AlertCircle size={18} />
                  <span style={{ fontWeight: 600 }}>{modalError}</span>
                </div>
                <button onClick={() => setModalError(null)} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer' }}>
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Modal Body */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', padding: 'var(--space-4)' }}>
              {/* Left: Adjustments */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {/* Cliente */}
                <div className="tc-card" style={{ padding: 'var(--space-3)', border: '2px solid var(--brand-100)' }}>
                  <h4 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--brand-700)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <User size={16} />
                    Cliente
                  </h4>
                  <select value={selectedCustomerId || ''} onChange={(e) => setSelectedCustomerId(Number(e.target.value) || null)} className="tc-input" style={{ width: '100%', minHeight: '44px', fontWeight: 700 }}>
                    <option value="">Consumidor Final</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.phone || 'S/T'})</option>
                    ))}
                  </select>
                </div>

                {/* Delivery & Discount */}
                <div className="tc-card" style={{ padding: 'var(--space-3)', border: '2px solid var(--brand-100)' }}>
                  <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--brand-700)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Tag size={16} />
                    Ajustes
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                    <div style={{ position: 'relative' }}>
                      <Truck style={{ position: 'absolute', left: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} size={14} />
                      <input type="number" placeholder="Delivery" value={deliveryFee || ''} onChange={(e) => setDeliveryFee(Number(e.target.value))} className="tc-input" style={{ paddingLeft: '32px', minHeight: '40px', background: '#fff' }} />
                    </div>
                    <div style={{ position: 'relative', display: 'flex', gap: '4px' }}>
                      {discountType === 'percentage' ? <Percent style={{ position: 'absolute', left: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} size={14} /> : <DollarSign style={{ position: 'absolute', left: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} size={14} />}
                      <input type="number" placeholder={discountType === 'percentage' ? '%' : '$'} value={globalDiscount || ''} onChange={(e) => setGlobalDiscount(Number(e.target.value))} className="tc-input" style={{ paddingLeft: '32px', minHeight: '40px', background: '#fff', width: '80px' }} />
                      <button type="button" onClick={() => setDiscountType(discountType === 'percentage' ? 'fixed' : 'percentage')} style={{ minHeight: '40px', padding: '0 var(--space-2)', border: '1px solid var(--gray-300)', borderRadius: 'var(--radius-md)', background: 'var(--gray-100)', cursor: 'pointer', fontWeight: 600 }}>
                        {discountType === 'percentage' ? '%' : '$'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Totales */}
                <div className="tc-card" style={{ padding: 'var(--space-4)', border: '2px solid var(--brand-200)', background: 'linear-gradient(135deg, var(--gray-50) 0%, #f0f4ff 100%)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--gray-600)' }}>Subtotal</span>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{formatCurrency(subtotal)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--gray-600)' }}>IVA</span>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{formatCurrency(tax)}</span>
                    </div>
                    {globalDiscount > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--gray-600)' }}>Descuento</span>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--success-600)' }}>-{formatCurrency(calculatedDiscount)}</span>
                      </div>
                    )}
                    {deliveryFee > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--gray-600)' }}>Delivery</span>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{formatCurrency(deliveryFee)}</span>
                      </div>
                    )}
                    <div style={{ borderTop: '2px solid var(--brand-300)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--brand-100)', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)' }}>
                      <span style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--brand-800)' }}>TOTAL</span>
                      <span style={{ fontSize: 'var(--text-3xl)', fontWeight: 900, color: 'var(--brand-600)' }}>{formatCurrency(total)}</span>
                    </div>
                  </div>
                </div>

                {/* Pagos registrados */}
                {payments.length > 0 && (
                  <div style={{ padding: 'var(--space-3)', background: 'linear-gradient(135deg, var(--success-50) 0%, #d1fae5 100%)', borderRadius: 'var(--radius-lg)', border: '2px solid var(--success-200)' }}>
                    <p style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--success-700)', marginBottom: 'var(--space-2)' }}>
                      ✓ Pagos: {formatCurrency(totalPaid)} / {formatCurrency(total)}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                      {payments.map((p, idx) => (
                        <span key={idx} className="tc-badge tc-badge--success">{p.method} {formatCurrency(p.amount)}</span>
                      ))}
                    </div>
                    {remaining > 0.1 && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--warning-600)', fontWeight: 700, marginTop: 'var(--space-2)' }}>Falta: {formatCurrency(remaining)}</p>}
                  </div>
                )}
              </div>

              {/* Right: Payment Methods */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="tc-card" style={{ padding: 'var(--space-4)', border: '2px solid var(--brand-200)', flex: 1 }}>
                  <h4 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--brand-700)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <CreditCard size={20} />
                    Método de Pago
                  </h4>

                  {paymentStep === 'options' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                      <button onClick={() => addPayment('efectivo')} disabled={remaining <= 0.1} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: '#fff', border: '2px solid var(--success-300)', color: 'var(--success-600)', fontWeight: 700, fontSize: 'var(--text-base)', cursor: remaining <= 0.1 ? 'not-allowed' : 'pointer', opacity: remaining <= 0.1 ? 0.5 : 1 }}>
                        <Banknote size={32} />
                        EFECTIVO
                      </button>
                      <button onClick={() => addPayment('nequi')} disabled={remaining <= 0.1} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: '#fff', border: '2px solid #e9d5ff', color: '#9333ea', fontWeight: 700, fontSize: 'var(--text-base)', cursor: remaining <= 0.1 ? 'not-allowed' : 'pointer', opacity: remaining <= 0.1 ? 0.5 : 1 }}>
                        <Smartphone size={32} />
                        NEQUI
                      </button>
                      <button onClick={() => addPayment('daviplata')} disabled={remaining <= 0.1} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: '#fff', border: '2px solid #fecaca', color: '#dc2626', fontWeight: 700, fontSize: 'var(--text-base)', cursor: remaining <= 0.1 ? 'not-allowed' : 'pointer', opacity: remaining <= 0.1 ? 0.5 : 1 }}>
                        <CreditCard size={32} />
                        DAVIPLATA
                      </button>
                      <button onClick={() => addPayment('transferencia')} disabled={remaining <= 0.1} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: '#fff', border: '2px solid var(--brand-300)', color: 'var(--brand-600)', fontWeight: 700, fontSize: 'var(--text-base)', cursor: remaining <= 0.1 ? 'not-allowed' : 'pointer', opacity: remaining <= 0.1 ? 0.5 : 1 }}>
                        <Navigation size={32} />
                        TRANSFER.
                      </button>
                      <button onClick={() => { if (remaining > 0.1) { setPaymentStep('mixed-step-1'); setMixtoCashAmount(0); } }} disabled={remaining <= 0.1} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: '#fff', border: '2px solid var(--warning-300)', color: 'var(--warning-600)', fontWeight: 700, fontSize: 'var(--text-base)', cursor: remaining <= 0.1 ? 'not-allowed' : 'pointer', opacity: remaining <= 0.1 ? 0.5 : 1 }}>
                        <CreditCard size={32} />
                        MIXTO
                      </button>
                      <button onClick={() => addPayment('credito')} disabled={remaining <= 0.1 || !selectedCustomerId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: selectedCustomerId && remaining > 0.1 ? '#fff' : '#f9fafb', border: `2px solid ${selectedCustomerId ? '#f59e0b' : '#e5e7eb'}`, color: selectedCustomerId && remaining > 0.1 ? '#d97706' : '#9ca3af', fontWeight: 700, fontSize: 'var(--text-base)', cursor: remaining <= 0.1 || !selectedCustomerId ? 'not-allowed' : 'pointer', opacity: remaining <= 0.1 || !selectedCustomerId ? 0.5 : 1 }}>
                        <Tag size={32} />
                        CRÉDITO
                      </button>
                    </div>
                  )}

                  {/* Cash input */}
                  {paymentStep === 'cash' && (
                    <div style={{ padding: 'var(--space-4)', background: 'linear-gradient(135deg, var(--success-50) 0%, #d1fae5 100%)', borderRadius: 'var(--radius-lg)', border: '2px solid var(--success-300)' }}>
                      <p style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--success-700)', marginBottom: 'var(--space-3)', textAlign: 'center' }}>¿Con cuánto paga?</p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)', padding: 'var(--space-2)', background: '#fff', borderRadius: 'var(--radius-md)' }}>
                        <span style={{ fontSize: 'var(--text-sm)' }}>Total:</span>
                        <span style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>{formatCurrency(remaining)}</span>
                      </div>
                      <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
                        <Banknote style={{ position: 'absolute', left: 'var(--space-3)', top: '50%', transform: 'translateY(-50%)', color: 'var(--success-600)' }} size={24} />
                        <input type="number" placeholder="Monto..." value={cashReceived || ''} onChange={(e) => setCashReceived(Number(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') confirmCashPayment(); }} className="tc-input" style={{ paddingLeft: '48px', minHeight: '56px', fontSize: 'var(--text-xl)', fontWeight: 700, background: '#fff', textAlign: 'right' }} autoFocus />
                      </div>
                      {cashReceived > 0 && (
                        <div style={{ padding: 'var(--space-3)', background: cashReceived >= remaining ? 'var(--success-100)' : 'var(--warning-100)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)', textAlign: 'center' }}>
                          {cashReceived >= remaining ? (
                            <div>
                              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--success-600)', marginBottom: '4px' }}>Cambio:</p>
                              <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 900, color: 'var(--success-700)' }}>{formatCurrency(cashReceived - remaining)}</p>
                            </div>
                          ) : (
                            <div>
                              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--warning-600)', marginBottom: '4px' }}>Falta:</p>
                              <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 900, color: 'var(--warning-700)' }}>{formatCurrency(remaining - cashReceived)}</p>
                            </div>
                          )}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button onClick={confirmCashPayment} disabled={cashReceived < remaining} style={{ flex: 1, padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: cashReceived >= remaining ? 'linear-gradient(135deg, var(--success-600) 0%, var(--success-500) 100%)' : 'var(--gray-300)', border: 'none', color: '#fff', fontWeight: 700, cursor: cashReceived >= remaining ? 'pointer' : 'not-allowed' }}>
                          {cashReceived >= remaining ? 'Confirmar' : 'Monto insuficiente'}
                        </button>
                        <button onClick={() => { setPaymentStep('options'); setCashReceived(0); setSelectedMethod(null); }} style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'transparent', border: '1px solid var(--gray-300)', color: 'var(--gray-600)', fontWeight: 600, cursor: 'pointer' }}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* MIXTO Step 1 */}
                  {paymentStep === 'mixed-step-1' && (
                    <div style={{ padding: 'var(--space-4)', background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', borderRadius: 'var(--radius-lg)', border: '2px solid #f59e0b' }}>
                      <p style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#92400e', marginBottom: 'var(--space-3)', textAlign: 'center' }}>¿Cuánto paga en efectivo?</p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)', padding: 'var(--space-2)', background: '#fff', borderRadius: 'var(--radius-md)' }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-600)' }}>Total a pagar:</span>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--gray-800)' }}>{formatCurrency(total)}</span>
                      </div>
                      <input type="number" value={mixtoCashAmount || ''} onChange={(e) => setMixtoCashAmount(Math.max(0, Number(e.target.value)))} placeholder="Monto en efectivo" autoFocus style={{ width: '100%', padding: 'var(--space-3)', fontSize: 'var(--text-lg)', fontWeight: 700, textAlign: 'center', border: '2px solid #f59e0b', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)', outline: 'none' }} />
                      <button onClick={confirmMixtoCash} disabled={mixtoCashAmount <= 0 || mixtoCashAmount >= total} style={{ width: '100%', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: mixtoCashAmount > 0 && mixtoCashAmount < total ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'var(--gray-300)', border: 'none', color: '#fff', fontWeight: 700, cursor: mixtoCashAmount > 0 && mixtoCashAmount < total ? 'pointer' : 'not-allowed' }}>
                        Continuar
                      </button>
                      <button onClick={() => { setPaymentStep('options'); setMixtoCashAmount(0); }} style={{ width: '100%', marginTop: 'var(--space-2)', padding: 'var(--space-2)', borderRadius: 'var(--radius-md)', background: 'transparent', border: '1px solid #f59e0b', color: '#92400e', fontWeight: 600, cursor: 'pointer' }}>
                        Cancelar
                      </button>
                    </div>
                  )}

                  {/* MIXTO Step 2 */}
                  {paymentStep === 'mixed-step-2' && (
                    <div style={{ padding: 'var(--space-4)', background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', borderRadius: 'var(--radius-lg)', border: '2px solid #f59e0b' }}>
                      <p style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#92400e', marginBottom: 'var(--space-3)', textAlign: 'center' }}>
                        Efectivo: {formatCurrency(mixtoCashAmount)} — Seleccione segundo método
                      </p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-3)', padding: 'var(--space-2)', background: '#fff', borderRadius: 'var(--radius-md)' }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-600)' }}>Resta por pagar:</span>
                        <span style={{ fontSize: 'var(--text-lg)', fontWeight: 900, color: '#dc2626' }}>{formatCurrency(total - mixtoCashAmount)}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                        <button onClick={() => addMixtoSecondPayment('nequi')} style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: '#fff', border: '2px solid #9333ea', color: '#9333ea', fontWeight: 700, fontSize: 'var(--text-xs)', cursor: 'pointer' }}>NEQUI</button>
                        <button onClick={() => addMixtoSecondPayment('daviplata')} style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: '#fff', border: '2px solid #dc2626', color: '#dc2626', fontWeight: 700, fontSize: 'var(--text-xs)', cursor: 'pointer' }}>DAVIPLATA</button>
                        <button onClick={() => addMixtoSecondPayment('transferencia')} style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: '#fff', border: '2px solid var(--brand-500)', color: 'var(--brand-600)', fontWeight: 700, fontSize: 'var(--text-xs)', cursor: 'pointer' }}>TRANSFER.</button>
                        <button onClick={() => addMixtoSecondPayment('credito')} disabled={!selectedCustomerId} style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: selectedCustomerId ? '#fff' : '#f9fafb', border: `2px solid ${selectedCustomerId ? '#f59e0b' : '#e5e7eb'}`, color: selectedCustomerId ? '#92400e' : '#9ca3af', fontWeight: 700, fontSize: 'var(--text-xs)', cursor: selectedCustomerId ? 'pointer' : 'not-allowed' }}>CRÉDITO</button>
                      </div>
                      <button onClick={() => { setPaymentStep('options'); setMixtoCashAmount(0); }} style={{ width: '100%', marginTop: 'var(--space-2)', padding: 'var(--space-2)', borderRadius: 'var(--radius-md)', background: 'transparent', border: '1px solid #f59e0b', color: '#92400e', fontWeight: 600, cursor: 'pointer' }}>
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>

                {/* Confirm Sale Button */}
                {(() => {
                  const hasCreditPayment = payments.some((p) => p.method === 'credito');
                  const isCreditFlow = hasCreditPayment && selectedCustomerId;
                  return (
                    <button onClick={handleCompleteSale} disabled={loading || remaining > 0.1 || cart.length === 0}
                      className="tc-btn tc-btn--success" style={{ width: '100%', minHeight: '56px', fontSize: 'var(--text-lg)', fontWeight: 800, textTransform: 'uppercase', borderRadius: 'var(--radius-lg)', background: remaining > 0.1 ? 'var(--gray-300)' : isCreditFlow ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' : 'linear-gradient(135deg, var(--success-600) 0%, var(--success-500) 100%)', opacity: remaining > 0.1 || cart.length === 0 ? 0.6 : 1 }}>
                      {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <div style={{ width: '20px', height: '20px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                          <span>Procesando...</span>
                        </div>
                      ) : remaining > 0.1 ? (
                        <span>Seleccione método de pago</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          {isCreditFlow ? <Tag size={24} /> : <CheckCircle2 size={24} />}
                          <span>{isCreditFlow ? 'FIAR' : 'Confirmar Venta'}</span>
                        </div>
                      )}
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOMER MODAL */}
      {showCustomerModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowCustomerModal(false); }}>
          <div className="tc-card" style={{ width: 'min(480px, 95vw)', padding: 'var(--space-6)', maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <h3 style={{ margin: 0, fontWeight: 700, fontSize: 'var(--text-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <User size={20} />
                Seleccionar Cliente
              </h3>
              <button onClick={() => setShowCustomerModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            <input type="text" placeholder="Buscar cliente por nombre o teléfono..." value={customerSearchTerm} onChange={(e) => setCustomerSearchTerm(e.target.value)} className="tc-input" style={{ width: '100%', minHeight: '44px', marginBottom: 'var(--space-3)' }} autoFocus />

            {customerSearchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                {customerSearchResults.map((c) => (
                  <div key={c.id} onClick={() => { setSelectedCustomerId(c.id); setShowCustomerModal(false); setCustomerSearchTerm(''); }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)', background: 'var(--gray-50)', border: '1px solid var(--gray-200)', cursor: 'pointer' }}>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--gray-800)' }}>{c.name}</p>
                      {c.phone && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--gray-500)' }}>{c.phone}</p>}
                    </div>
                    <Check size={selectedCustomerId === c.id ? 18 : 0} style={{ color: 'var(--brand-600)' }} />
                  </div>
                ))}
              </div>
            )}

            {/* Create Customer */}
            <div style={{ borderTop: '1px solid var(--gray-200)', paddingTop: 'var(--space-4)' }}>
              <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--gray-700)', marginBottom: 'var(--space-3)' }}>Crear nuevo cliente</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <input type="text" placeholder="Nombre del cliente" value={customerCreateName} onChange={(e) => setCustomerCreateName(e.target.value)} className="tc-input" style={{ minHeight: '40px' }} />
                <input type="text" placeholder="Teléfono (opcional)" value={customerCreatePhone} onChange={(e) => setCustomerCreatePhone(e.target.value)} className="tc-input" style={{ minHeight: '40px' }} />
                <button onClick={handleCreateCustomer} disabled={!customerCreateName.trim()} className="tc-btn tc-btn--primary" style={{ minHeight: '40px', fontWeight: 700 }}>
                  <Plus size={16} style={{ marginRight: 'var(--space-2)' }} />
                  Crear Cliente
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
