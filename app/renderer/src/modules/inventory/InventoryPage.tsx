import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Package, AlertTriangle, CheckCircle, Upload,
  Edit2, Trash2, Box, BarChart3, Download, Printer, FileSpreadsheet,
} from 'lucide-react';
import { trpc } from '../../trpc';
import { useAuth } from '../../shared/context/AuthContext';
import { formatCurrency, formatDate } from '../../shared/utils/formatters';
import { es } from '../../shared/i18n';
import {
  SearchInput, Pagination, DataTable, SelectInput,
  LoadingSpinner, EmptyState, LoadingButton, Card, Modal, ConfirmDialog,
} from '../../shared/components';
import type { Column } from '../../shared/components';
import type {
  Product, ProductInput, Category, StockAlerts, StockMovementType,
} from '../../shared/types/inventory.types';

const PAGE_SIZE = 20;

type ProductFormData = {
  code: string;
  barcode: string;
  name: string;
  description: string;
  categoryId: number | '';
  price: string;
  cost: string;
  stock: string;
  minStock: string;
  criticalStock: string;
  expiryDate: string;
  location: string;
  unitType: string;
  conversionFactor: string;
};

const emptyForm: ProductFormData = {
  code: '',
  barcode: '',
  name: '',
  description: '',
  categoryId: '',
  price: '',
  cost: '',
  stock: '',
  minStock: '',
  criticalStock: '',
  expiryDate: '',
  location: '',
  unitType: 'unidad',
  conversionFactor: '1',
};

function getStockBadgeClasses(stock: number, minStock: number, criticalStock: number): string {
  if (stock <= criticalStock) return 'bg-red-50 text-red-700';
  if (stock <= minStock) return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
}

function getStockLabel(stock: number, minStock: number, criticalStock: number): string {
  if (stock <= criticalStock) return es.inventory.stockCritical;
  if (stock <= minStock) return es.inventory.stockWarning;
  return es.inventory.stockOk;
}

export default function InventoryPage(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stockAlerts, setStockAlerts] = useState<StockAlerts | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [printingLabels, setPrintingLabels] = useState(false);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustType, setAdjustType] = useState<StockMovementType>('entrada');
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchProducts = useCallback(async () => {
    try {
      const result = await trpc.inventory.getAll.query({
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        categoryId: categoryFilter ? Number(categoryFilter) : undefined,
      });
      setProducts(result.products);
      setTotal(result.total);
    } catch (err) {
      rendererLogger.error('InventoryPage', 'Error fetching products:', err);
    }
  }, [page, search, categoryFilter]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const [cats, alerts] = await Promise.all([
          trpc.inventory.getCategories.query(),
          trpc.inventory.getStockAlerts.query(),
        ]);
        if (cancelled) return;
        setCategories(cats);
        setStockAlerts(alerts);
      } catch (err) {
        rendererLogger.error('InventoryPage', 'Error loading inventory data:', err);
      }
    };
    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      await fetchProducts();
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [fetchProducts]);

  const handleOpenForm = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setFormData({
        code: product.code,
        barcode: product.barcode ?? '',
        name: product.name,
        description: product.description ?? '',
        categoryId: product.categoryId ?? '',
        price: String(product.price),
        cost: String(product.cost),
        stock: String(product.stock),
        minStock: String(product.minStock),
        criticalStock: String(product.criticalStock),
        expiryDate: product.expiryDate ?? '',
        location: product.location ?? '',
        unitType: product.unitType,
        conversionFactor: String(product.conversionFactor ?? 1),
      });
    } else {
      setEditingProduct(null);
      setFormData(emptyForm);
    }
    setShowFormModal(true);
  };

  const handleSaveProduct = async () => {
    if (!formData.code.trim() || !formData.name.trim() || !formData.price || !formData.cost || !user) return;
    setSaving(true);
    try {
      const input: ProductInput = {
        code: formData.code.trim(),
        barcode: formData.barcode.trim() || null,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        categoryId: formData.categoryId ? Number(formData.categoryId) : undefined,
        price: Number(formData.price),
        cost: Number(formData.cost),
        stock: Number(formData.stock),
        minStock: Number(formData.minStock) || 0,
        criticalStock: Number(formData.criticalStock) || 0,
        expiryDate: formData.expiryDate || null,
        location: formData.location.trim() || null,
        unitType: formData.unitType || 'unidad',
        conversionFactor: Number(formData.conversionFactor) || 1,
        userId: user.id,
      };

      if (editingProduct) {
        await trpc.inventory.update.mutate({ id: editingProduct.id, data: input });
      } else {
        await trpc.inventory.create.mutate({ data: input });
      }

      setShowFormModal(false);
      fetchProducts();

      const alerts = await trpc.inventory.getStockAlerts.query();
      setStockAlerts(alerts);
    } catch (err) {
      rendererLogger.error('InventoryPage', 'Error saving product:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenAdjust = (product: Product) => {
    setAdjustProduct(product);
    setAdjustType('entrada');
    setAdjustQty('');
    setAdjustReason('');
    setShowAdjustModal(true);
  };

  const handleAdjustStock = async () => {
    if (!adjustProduct || !adjustQty || !user) return;
    const qty = Number(adjustQty);
    if (qty <= 0) return;
    setAdjusting(true);
    try {
      const finalQty = adjustType === 'salida' ? -qty : qty;
      await trpc.inventory.adjustStock.mutate({
        productId: adjustProduct.id,
        quantity: finalQty,
        reason: adjustReason.trim() || '',
        userId: user.id,
      });
      setShowAdjustModal(false);
      fetchProducts();

      const alerts = await trpc.inventory.getStockAlerts.query();
      setStockAlerts(alerts);
    } catch (err) {
      rendererLogger.error('InventoryPage', 'Error adjusting stock:', err);
    } finally {
      setAdjusting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await trpc.inventory.delete.mutate({ id: deleteTarget.id });
      setDeleteTarget(null);
      fetchProducts();

      const alerts = await trpc.inventory.getStockAlerts.query();
      setStockAlerts(alerts);
    } catch (err) {
      rendererLogger.error('InventoryPage', 'Error deleting product:', err);
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: Column<Product>[] = [
    {
      key: 'code',
      header: es.inventory.code,
      className: 'font-mono text-xs',
    },
    {
      key: 'name',
      header: es.inventory.name,
      render: (p) => (
        <div>
          <span className="font-medium text-gray-900">{p.name}</span>
          {p.barcode && <span className="block text-xs text-gray-400 font-mono">{p.barcode}</span>}
        </div>
      ),
    },
    {
      key: 'category',
      header: es.inventory.category,
      render: (p) => (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium"
          style={{ backgroundColor: p.category.color ? `${p.category.color}20` : '#f3f4f6', color: p.category.color ?? '#6b7280' }}
        >
          {p.category.color && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.category.color }} />}
          {p.category.name}
        </span>
      ),
    },
    {
      key: 'stock',
      header: es.inventory.stock,
      render: (p) => (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${getStockBadgeClasses(p.stock, p.minStock, p.criticalStock)}`}>
          <Box size={13} />
          {p.stock}
          <span className="opacity-70">({getStockLabel(p.stock, p.minStock, p.criticalStock).charAt(0)})</span>
        </span>
      ),
    },
    {
      key: 'price',
      header: es.inventory.price,
      render: (p) => <span className="font-medium">{formatCurrency(p.price)}</span>,
    },
    {
      key: 'cost',
      header: es.inventory.cost,
      render: (p) => <span className="text-gray-500">{formatCurrency(p.cost)}</span>,
    },
    {
      key: 'expiryDate',
      header: es.inventory.expiryDate,
      render: (p) => p.expiryDate ? (
        <span className={`text-xs ${new Date(p.expiryDate) < new Date() ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
          {formatDate(p.expiryDate)}
        </span>
      ) : <span className="text-gray-300">&mdash;</span>,
    },
    {
      key: 'actions',
      header: es.inventory.actions,
      className: 'text-right',
      render: (p) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => handleOpenAdjust(p)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            title={es.inventory.adjustStock}
          >
            <BarChart3 size={15} />
          </button>
          <button
            type="button"
            onClick={() => handleOpenForm(p)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
            title={es.common.edit}
          >
            <Edit2 size={15} />
          </button>
          <button
            type="button"
            onClick={() => handlePrintLabel(p.id)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
            title="Imprimir etiqueta"
          >
            <Printer size={15} />
          </button>
          <button
            type="button"
            onClick={() => setDeleteTarget(p)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            title={es.common.delete}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  const criticalCount = stockAlerts?.critical.length ?? 0;
  const warningCount = stockAlerts?.warning.length ?? 0;
  const okCount = stockAlerts?.ok.length ?? 0;

  const handleExport = async (format: 'csv' | 'xlsx' = 'csv') => {
    setExporting(true);
    try {
      const result = await trpc.export.inventory.mutate({ format });
      const { path } = result as { path: string };
      if (path && window.api.openFile) {
        await window.api.openFile(path);
      }
    } catch (err) {
      rendererLogger.error('InventoryPage', 'Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  const handlePrintLabel = async (productId: number) => {
    try {
      const result = await trpc.labels.generate.mutate({ productIds: [productId], copiesPerProduct: 1 });
      const { path } = result as { path: string };
      if (path && window.api?.openFile) {
        await window.api.openFile(path);
      }
    } catch (err) {
      rendererLogger.error('InventoryPage', 'Label error:', err);
    }
  };

  const handlePrintAllLabels = async () => {
    if (products.length === 0) return;
    setPrintingLabels(true);
    try {
      const ids = products.map((p) => p.id);
      const result = await trpc.labels.generate.mutate({ productIds: ids, copiesPerProduct: 1 });
      const { path } = result as { path: string };
      if (path && window.api?.openFile) {
        await window.api.openFile(path);
      }
    } catch (err) {
      rendererLogger.error('InventoryPage', 'Labels error:', err);
    } finally {
      setPrintingLabels(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{es.inventory.title}</h1>
          <p className="text-sm text-gray-500 mt-1">{es.inventory.subtitle}</p>
        </div>
        <div className="flex gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleExport('csv')}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <Download size={16} />
              {exporting ? 'Exportando...' : 'CSV'}
            </button>
            <button
              type="button"
              onClick={() => handleExport('xlsx')}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2.5 border border-blue-200 rounded-lg text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors disabled:opacity-50"
            >
              <FileSpreadsheet size={16} />
              {exporting ? 'Exportando...' : 'XLSX'}
            </button>
          </div>
          <button
            type="button"
            onClick={handlePrintAllLabels}
            disabled={printingLabels || products.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <Printer size={16} />
            {printingLabels ? 'Generando...' : 'Etiquetas'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/inventory/import')}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
          >
            <Upload size={16} />
            {es.inventory.bulkImport}
          </button>
          <LoadingButton onClick={() => handleOpenForm()}>
            <Plus size={16} />
            {es.inventory.addProduct}
          </LoadingButton>
        </div>
      </div>

      {/* ── Stock Alerts Summary ── */}
      <div className="tc-grid-3">
        <div className={`tc-metric ${criticalCount > 0 ? 'border-l-4 border-l-red-500' : ''}`} style={{ borderLeftWidth: criticalCount > 0 ? 4 : 0, borderLeftColor: criticalCount > 0 ? '#f04438' : undefined }}>
          <div className="flex items-center gap-3">
            <div className="tc-metric-icon" style={{ background: criticalCount > 0 ? '#fef3f2' : 'var(--gray-100)' }}>
              <AlertTriangle size={20} className={criticalCount > 0 ? 'text-red-600' : 'text-gray-400'} />
            </div>
            <div>
              <p className="tc-metric-label">{es.inventory.critical}</p>
              <p className="tc-metric-value">{criticalCount}</p>
            </div>
          </div>
        </div>
        <div className={`tc-metric ${warningCount > 0 ? 'border-l-4 border-l-amber-500' : ''}`} style={{ borderLeftWidth: warningCount > 0 ? 4 : 0, borderLeftColor: warningCount > 0 ? '#f79009' : undefined }}>
          <div className="flex items-center gap-3">
            <div className="tc-metric-icon" style={{ background: warningCount > 0 ? '#fffaeb' : 'var(--gray-100)' }}>
              <AlertTriangle size={20} className={warningCount > 0 ? 'text-amber-600' : 'text-gray-400'} />
            </div>
            <div>
              <p className="tc-metric-label">{es.inventory.warning}</p>
              <p className="tc-metric-value">{warningCount}</p>
            </div>
          </div>
        </div>
        <div className="tc-metric">
          <div className="flex items-center gap-3">
            <div className="tc-metric-icon" style={{ background: '#ecfdf3' }}>
              <CheckCircle size={20} className="text-emerald-600" />
            </div>
            <div>
              <p className="tc-metric-label">{es.inventory.goodStock}</p>
              <p className="tc-metric-value">{okCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1); }}
          placeholder={es.inventory.searchHint}
          className="flex-1"
        />
        <SelectInput
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          options={[
            { value: '', label: es.inventory.all },
            ...categories.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
          className="w-full sm:w-48"
        />
      </div>

      {/* ── Products Table ── */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <LoadingSpinner size={32} />
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={Package}
            title={es.common.noResults}
            description={es.inventory.searchHint}
            action={
              <LoadingButton onClick={() => handleOpenForm()} variant="primary">
                <Plus size={16} />
                {es.inventory.addProduct}
              </LoadingButton>
            }
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              data={products}
              keyExtractor={(p) => p.id}
            />
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      {/* ── Add / Edit Product Modal ── */}
      <Modal
        isOpen={showFormModal}
        onClose={() => setShowFormModal(false)}
        title={editingProduct ? es.inventory.editProduct : es.inventory.addProduct}
        size="lg"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowFormModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 border-none cursor-pointer"
            >
              {es.common.cancel}
            </button>
            <LoadingButton onClick={handleSaveProduct} loading={saving}>
              {es.common.save}
            </LoadingButton>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="tc-field">
            <label className="tc-label">{es.inventory.code} *</label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              className="tc-input"
              required
            />
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.barcode}</label>
            <input
              type="text"
              value={formData.barcode}
              onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
              className="tc-input"
            />
          </div>
          <div className="tc-field md:col-span-2">
            <label className="tc-label">{es.inventory.name} *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="tc-input"
              required
            />
          </div>
          <div className="tc-field md:col-span-2">
            <label className="tc-label">{es.inventory.description}</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="tc-input min-h-[80px] resize-y"
              rows={3}
            />
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.category}</label>
            <select
              value={formData.categoryId}
              onChange={(e) => setFormData({ ...formData, categoryId: e.target.value ? Number(e.target.value) : '' })}
              className="tc-input"
            >
              <option value="">{es.inventory.all}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.unitType}</label>
            <select
              value={formData.unitType}
              onChange={(e) => setFormData({ ...formData, unitType: e.target.value })}
              className="tc-input"
            >
              <option value="unidad">{es.inventory.unit}</option>
              <option value="paquete">{es.inventory.package}</option>
            </select>
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.price} *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              className="tc-input"
              required
            />
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.cost} *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
              className="tc-input"
              required
            />
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.stock} *</label>
            <input
              type="number"
              step="1"
              min="0"
              value={formData.stock}
              onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
              className="tc-input"
              required
            />
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.minStock}</label>
            <input
              type="number"
              step="1"
              min="0"
              value={formData.minStock}
              onChange={(e) => setFormData({ ...formData, minStock: e.target.value })}
              className="tc-input"
            />
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.criticalStock}</label>
            <input
              type="number"
              step="1"
              min="0"
              value={formData.criticalStock}
              onChange={(e) => setFormData({ ...formData, criticalStock: e.target.value })}
              className="tc-input"
            />
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.expiryDate}</label>
            <input
              type="date"
              value={formData.expiryDate}
              onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
              className="tc-input"
            />
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.location}</label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="tc-input"
            />
          </div>
        </div>
      </Modal>

      {/* ── Stock Adjustment Modal ── */}
      <Modal
        isOpen={showAdjustModal}
        onClose={() => setShowAdjustModal(false)}
        title={`${es.inventory.adjustStock} - ${adjustProduct?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowAdjustModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 border-none cursor-pointer"
            >
              {es.common.cancel}
            </button>
            <LoadingButton onClick={handleAdjustStock} loading={adjusting} variant="primary">
              {es.common.confirm}
            </LoadingButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="tc-field">
            <label className="tc-label">{es.inventory.adjustmentType}</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setAdjustType('entrada')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                  adjustType === 'entrada'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {es.inventory.addEntry}
              </button>
              <button
                type="button"
                onClick={() => setAdjustType('salida')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                  adjustType === 'salida'
                    ? 'bg-red-50 border-red-300 text-red-700'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {es.inventory.subtractEntry}
              </button>
            </div>
          </div>
          <div className="tc-field">
            <label className="tc-label">{es.inventory.quantity} *</label>
            <input
              type="number"
              step="1"
              min="1"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
              className="tc-input"
              placeholder="0"
            />
          </div>
          {adjustProduct && (
            <p className="text-xs text-gray-400">
              {es.inventory.stock}: <strong>{adjustProduct.stock}</strong>
            </p>
          )}
          <div className="tc-field">
            <label className="tc-label">{es.inventory.reason}</label>
            <input
              type="text"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              className="tc-input"
              placeholder={es.inventory.adjustReason}
            />
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirmation ── */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={es.inventory.deleteProduct}
        message={`${es.common.confirm} "${deleteTarget?.name}"?`}
        confirmLabel={es.common.delete}
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
