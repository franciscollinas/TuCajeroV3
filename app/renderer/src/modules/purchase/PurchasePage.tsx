import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, Package, Truck,
  CheckCircle2, XCircle, Send, Calendar,
  DollarSign, Building2, Phone, Mail, MapPin, Clock,
} from 'lucide-react';
import { trpc } from '../../trpc';
import { useAuth } from '../../shared/context/AuthContext';
import { formatCurrency, formatDate } from '../../shared/utils/formatters';
import { Card } from '../../shared/components/Card';
import { DataTable } from '../../shared/components/DataTable';
import type { Column } from '../../shared/components/DataTable';
import { Modal } from '../../shared/components/Modal';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { EmptyState } from '../../shared/components/EmptyState';
import type {
  Supplier, PurchaseOrder,
  PurchaseOrderStatus, CreateSupplierInput, PurchaseSummary,
} from '../../shared/types/purchase.types';
import type { Product } from '../../shared/types/inventory.types';

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmado',
  SENT: 'Enviado',
  RECEIVED: 'Recibido',
  CANCELLED: 'Cancelado',
};

export default function PurchasePage(): JSX.Element {
  const { user, currentBranch } = useAuth();
  const [activeTab, setActiveTab] = useState<'suppliers' | 'orders'>('suppliers');
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [summary, setSummary] = useState<PurchaseSummary | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  // Supplier modal state
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierForm, setSupplierForm] = useState<CreateSupplierInput>({
    name: '', contactPerson: '', phone: '', email: '', address: '', leadTimeDays: 0, notes: '',
  });
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Delete supplier confirm
  const [deleteSupplierId, setDeleteSupplierId] = useState<number | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState(false);

  // Order modal state
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [orderDetailOpen, setOrderDetailOpen] = useState(false);
  const [orderFormSupplierId, setOrderFormSupplierId] = useState<number>(0);
  const [orderFormItems, setOrderFormItems] = useState<{ productId: number; quantityOrdered: number; unitCost: number }[]>([]);
  const [orderFormFreight, setOrderFormFreight] = useState(0);
  const [orderFormExpectedDate, setOrderFormExpectedDate] = useState('');
  const [orderFormNotes, setOrderFormNotes] = useState('');
  const [savingOrder, setSavingOrder] = useState(false);

  // Receive modal state
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [receiveItems, setReceiveItems] = useState<{ orderItemId: number; quantityReceived: number; received: boolean; observations?: string }[]>([]);
  const [savingReceive, setSavingReceive] = useState(false);

  // Delete order confirm
  const [deleteOrderId, setDeleteOrderId] = useState<number | null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const branchId = currentBranch?.id;
    try {
      const [suppliersData, ordersData, summaryData, productsData] = await Promise.all([
        trpc.purchase.suppliers.list.query(),
        trpc.purchase.orders.list.query({ branchId }),
        trpc.purchase.orders.summary.query(),
        trpc.inventory.getAll.query({}),
      ]);
      setSuppliers(suppliersData as Supplier[]);
      setOrders(ordersData as PurchaseOrder[]);
      setSummary(summaryData as PurchaseSummary);
      setProducts((productsData as { products: Product[] }).products);
    } catch (err) {
      rendererLogger.error('PurchasePage', 'Error fetching purchase data:', err);
    } finally {
      setLoading(false);
    }
  }, [currentBranch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Supplier handlers ──
  const openCreateSupplier = () => {
    setEditingSupplier(null);
    setSupplierForm({ name: '', contactPerson: '', phone: '', email: '', address: '', leadTimeDays: 0, notes: '' });
    setSupplierModalOpen(true);
  };

  const openEditSupplier = (s: Supplier) => {
    setEditingSupplier(s);
    setSupplierForm({
      name: s.name,
      contactPerson: s.contactPerson ?? '',
      phone: s.phone,
      email: s.email ?? '',
      address: s.address ?? '',
      leadTimeDays: s.leadTimeDays ?? 0,
      notes: s.notes ?? '',
    });
    setSupplierModalOpen(true);
  };

  const handleSaveSupplier = async () => {
    if (!supplierForm.name.trim() || !supplierForm.phone.trim()) return;
    setSavingSupplier(true);
    try {
      if (editingSupplier) {
        const result = await trpc.purchase.suppliers.update.mutate({ id: editingSupplier.id, data: supplierForm });
        setSuppliers((prev) => prev.map((s) => (s.id === editingSupplier.id ? result as Supplier : s)));
      } else {
        const result = await trpc.purchase.suppliers.create.mutate({ data: supplierForm });
        setSuppliers((prev) => [...prev, result as Supplier]);
      }
      setSupplierModalOpen(false);
    } catch (err) {
      rendererLogger.error('PurchasePage', 'Error saving supplier:', err);
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleDeleteSupplier = async () => {
    if (deleteSupplierId === null) return;
    setDeletingSupplier(true);
    try {
      await trpc.purchase.suppliers.delete.mutate({ id: deleteSupplierId });
      setSuppliers((prev) => prev.filter((s) => s.id !== deleteSupplierId));
      setDeleteSupplierId(null);
    } catch (err) {
      rendererLogger.error('PurchasePage', 'Error deleting supplier:', err);
    } finally {
      setDeletingSupplier(false);
    }
  };

  // ── Order handlers ──
  const openCreateOrder = () => {
    setOrderFormSupplierId(0);
    setOrderFormItems([]);
    setOrderFormFreight(0);
    setOrderFormExpectedDate('');
    setOrderFormNotes('');
    setOrderModalOpen(true);
  };

  const addOrderItem = () => {
    setOrderFormItems((prev) => [...prev, { productId: 0, quantityOrdered: 1, unitCost: 0 }]);
  };

  const updateOrderItem = (index: number, field: string, value: number) => {
    setOrderFormItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const removeOrderItem = (index: number) => {
    setOrderFormItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveOrder = async () => {
    if (!orderFormSupplierId || orderFormItems.length === 0 || !user) return;
    setSavingOrder(true);
    try {
      const result = await trpc.purchase.orders.create.mutate({
        data: {
          supplierId: orderFormSupplierId,
          items: orderFormItems.map((item) => ({
            productId: item.productId,
            quantityOrdered: item.quantityOrdered,
            unitCost: item.unitCost,
          })),
          freight: orderFormFreight || undefined,
          expectedDate: orderFormExpectedDate || undefined,
          notes: orderFormNotes || undefined,
        },
        userId: user.id,
      });
      setOrders((prev) => [...prev, result as PurchaseOrder]);
      setOrderModalOpen(false);
    } catch (err) {
      rendererLogger.error('PurchasePage', 'Error creating order:', err);
    } finally {
      setSavingOrder(false);
    }
  };

  const openOrderDetail = async (order: PurchaseOrder) => {
    try {
      const detail = await trpc.purchase.orders.getById.query({ id: order.id });
      setSelectedOrder(detail as PurchaseOrder);
      setOrderDetailOpen(true);
    } catch (err) {
      rendererLogger.error('PurchasePage', 'Error fetching order detail:', err);
    }
  };

  const handleUpdateStatus = async (id: number, status: PurchaseOrderStatus) => {
    try {
      const result = await trpc.purchase.orders.updateStatus.mutate({ id, status });
      setOrders((prev) => prev.map((o) => (o.id === id ? result as PurchaseOrder : o)));
      if (selectedOrder?.id === id) setSelectedOrder(result as PurchaseOrder);
    } catch (err) {
      rendererLogger.error('PurchasePage', 'Error updating status:', err);
    }
  };

  const openReceiveItems = (order: PurchaseOrder) => {
    setSelectedOrder(order);
    setReceiveItems(
      order.items.map((item) => ({
        orderItemId: item.id,
        quantityReceived: item.quantityReceived ?? 0,
        received: item.received,
        observations: item.observations ?? '',
      }))
    );
    setReceiveModalOpen(true);
  };

  const handleReceiveItems = async () => {
    if (!selectedOrder || !user) return;
    setSavingReceive(true);
    try {
      const result = await trpc.purchase.orders.receiveItems.mutate({
        id: selectedOrder.id,
        userId: user.id,
        items: receiveItems,
      });
      setOrders((prev) => prev.map((o) => (o.id === selectedOrder.id ? result as PurchaseOrder : o)));
      setSelectedOrder(result as PurchaseOrder);
      setReceiveModalOpen(false);
    } catch (err) {
      rendererLogger.error('PurchasePage', 'Error receiving items:', err);
    } finally {
      setSavingReceive(false);
    }
  };

  const handleDeleteOrder = async () => {
    if (deleteOrderId === null) return;
    setDeletingOrder(true);
    try {
      await trpc.purchase.orders.delete.mutate({ id: deleteOrderId });
      setOrders((prev) => prev.filter((o) => o.id !== deleteOrderId));
      setDeleteOrderId(null);
    } catch (err) {
      rendererLogger.error('PurchasePage', 'Error deleting order:', err);
    } finally {
      setDeletingOrder(false);
    }
  };

  // ── Columns ──
  const supplierColumns: Column<Supplier>[] = [
    { key: 'name', header: 'Nombre', render: (s) => <span className="font-medium text-gray-900">{s.name}</span> },
    { key: 'contactPerson', header: 'Contacto', render: (s) => s.contactPerson || '\u2014' },
    { key: 'phone', header: 'Teléfono', render: (s) => (
      <span className="inline-flex items-center gap-1"><Phone size={13} className="text-gray-400" />{s.phone}</span>
    )},
    { key: 'email', header: 'Email', render: (s) => s.email ? (
      <span className="inline-flex items-center gap-1"><Mail size={13} className="text-gray-400" />{s.email}</span>
    ) : '\u2014' },
    { key: 'address', header: 'Dirección', render: (s) => s.address ? (
      <span className="inline-flex items-center gap-1"><MapPin size={13} className="text-gray-400" />{s.address}</span>
    ) : '\u2014' },
    { key: 'leadTimeDays', header: 'Lead Time', render: (s) => s.leadTimeDays ? (
      <span className="inline-flex items-center gap-1"><Clock size={13} className="text-gray-400" />{s.leadTimeDays} días</span>
    ) : '\u2014' },
    { key: 'isActive', header: 'Estado', render: (s) => <StatusBadge status={s.isActive ? 'active' : 'inactive'} label={s.isActive ? 'Activo' : 'Inactivo'} /> },
    {
      key: 'actions', header: 'Acciones', className: 'text-right',
      render: (s) => (
        <div className="flex justify-end gap-2">
          <button onClick={() => openEditSupplier(s)} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
            <Pencil size={15} />
          </button>
          <button onClick={() => setDeleteSupplierId(s.id)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar">
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  const orderColumns: Column<PurchaseOrder>[] = [
    { key: 'orderNumber', header: 'Pedido', render: (o) => <span className="font-medium text-indigo-600">{o.orderNumber}</span> },
    { key: 'supplier', header: 'Proveedor', render: (o) => o.supplier?.name ?? '\u2014' },
    { key: 'status', header: 'Estado', render: (o) => <StatusBadge status={o.status.toLowerCase()} label={STATUS_LABELS[o.status]} /> },
    { key: 'total', header: 'Total', render: (o) => <span className="font-semibold">{formatCurrency(o.total)}</span> },
    { key: 'createdAt', header: 'Fecha', render: (o) => formatDate(o.createdAt) },
    {
      key: 'actions', header: 'Acciones', className: 'text-right',
      render: (o) => (
        <div className="flex justify-end gap-2">
          <button onClick={() => openOrderDetail(o)} className="px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
            Ver
          </button>
          {o.status === 'DRAFT' && (
            <button onClick={() => setDeleteOrderId(o.id)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ),
    },
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
      {/* ── Header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-6 text-white">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24 pointer-events-none" />
        <div className="relative z-10">
          <h1 className="text-2xl font-bold">Compras</h1>
          <p className="text-emerald-200 mt-1">Gestiona proveedores y órdenes de compra</p>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Package size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Total pedidos</p>
              <p className="text-xl font-bold text-gray-900">{summary?.totalOrders ?? 0}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Clock size={20} className="text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Pendientes</p>
              <p className="text-xl font-bold text-gray-900">{summary?.pendingOrders ?? 0}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <CheckCircle2 size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Recibidos</p>
              <p className="text-xl font-bold text-gray-900">{summary?.receivedOrders ?? 0}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <DollarSign size={20} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Valor total</p>
              <p className="text-xl font-bold text-gray-900">{summary ? formatCurrency(summary.totalValue) : '--'}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('suppliers')}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'suppliers' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Building2 size={16} className="inline mr-1.5" />
          Proveedores
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'orders' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Truck size={16} className="inline mr-1.5" />
          Pedidos
        </button>
      </div>

      {/* ── Suppliers Tab ── */}
      {activeTab === 'suppliers' && (
        <Card
          title="Proveedores"
          actions={
            <button onClick={openCreateSupplier} className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors">
              <Plus size={16} />
              Crear proveedor
            </button>
          }
        >
          {suppliers.length === 0 ? (
            <EmptyState icon={Building2} title="No hay proveedores" description="Crea tu primer proveedor para comenzar." />
          ) : (
            <DataTable columns={supplierColumns} data={suppliers} keyExtractor={(s) => s.id} />
          )}
        </Card>
      )}

      {/* ── Orders Tab ── */}
      {activeTab === 'orders' && (
        <Card
          title="Órdenes de compra"
          actions={
            <button onClick={openCreateOrder} className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
              <Plus size={16} />
              Crear pedido
            </button>
          }
        >
          {orders.length === 0 ? (
            <EmptyState icon={Truck} title="No hay pedidos" description="Crea tu primer pedido de compra." />
          ) : (
            <DataTable columns={orderColumns} data={orders} keyExtractor={(o) => o.id} />
          )}
        </Card>
      )}

      {/* ══════════════════════ SUPPLIER MODAL ══════════════════════ */}
      <Modal
        isOpen={supplierModalOpen}
        onClose={() => setSupplierModalOpen(false)}
        title={editingSupplier ? 'Editar proveedor' : 'Crear proveedor'}
        size="lg"
        footer={
          <>
            <LoadingButton variant="secondary" onClick={() => setSupplierModalOpen(false)}>
              Cancelar
            </LoadingButton>
            <LoadingButton loading={savingSupplier} onClick={handleSaveSupplier}>
              {editingSupplier ? 'Actualizar' : 'Crear'}
            </LoadingButton>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
            <input
              type="text" value={supplierForm.name}
              onChange={(e) => setSupplierForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              placeholder="Nombre del proveedor"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Persona de contacto</label>
            <input
              type="text" value={supplierForm.contactPerson ?? ''}
              onChange={(e) => setSupplierForm((p) => ({ ...p, contactPerson: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              placeholder="Nombre del contacto"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono *</label>
            <input
              type="text" value={supplierForm.phone}
              onChange={(e) => setSupplierForm((p) => ({ ...p, phone: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              placeholder="Número de teléfono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email" value={supplierForm.email ?? ''}
              onChange={(e) => setSupplierForm((p) => ({ ...p, email: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              placeholder="correo@ejemplo.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
            <input
              type="text" value={supplierForm.address ?? ''}
              onChange={(e) => setSupplierForm((p) => ({ ...p, address: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              placeholder="Dirección"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Días de entrega (lead time)</label>
            <input
              type="number" min="0" value={supplierForm.leadTimeDays ?? ''}
              onChange={(e) => setSupplierForm((p) => ({ ...p, leadTimeDays: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
            <textarea
              rows={2} value={supplierForm.notes ?? ''}
              onChange={(e) => setSupplierForm((p) => ({ ...p, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
              placeholder="Notas adicionales..."
            />
          </div>
        </div>
      </Modal>

      {/* ══════════════════════ DELETE SUPPLIER CONFIRM ══════════════════════ */}
      <Modal
        isOpen={deleteSupplierId !== null}
        onClose={() => setDeleteSupplierId(null)}
        title="Eliminar proveedor"
        size="sm"
        footer={
          <>
            <LoadingButton variant="secondary" onClick={() => setDeleteSupplierId(null)}>
              Cancelar
            </LoadingButton>
            <LoadingButton variant="danger" loading={deletingSupplier} onClick={handleDeleteSupplier}>
              Eliminar
            </LoadingButton>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          ¿Estás seguro de eliminar este proveedor? Esta acción no se puede deshacer.
        </p>
      </Modal>

      {/* ══════════════════════ CREATE ORDER MODAL ══════════════════════ */}
      <Modal
        isOpen={orderModalOpen}
        onClose={() => setOrderModalOpen(false)}
        title="Crear pedido de compra"
        size="xl"
        footer={
          <>
            <LoadingButton variant="secondary" onClick={() => setOrderModalOpen(false)}>
              Cancelar
            </LoadingButton>
            <LoadingButton loading={savingOrder} onClick={handleSaveOrder} disabled={!orderFormSupplierId || orderFormItems.length === 0}>
              Crear pedido
            </LoadingButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor *</label>
            <select
              value={orderFormSupplierId}
              onChange={(e) => setOrderFormSupplierId(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value={0}>Seleccionar proveedor...</option>
              {suppliers.filter((s) => s.isActive).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Productos *</label>
              <button onClick={addOrderItem} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                + Agregar producto
              </button>
            </div>
            {orderFormItems.length === 0 ? (
              <p className="text-sm text-gray-400 py-3 text-center">Agrega al menos un producto al pedido.</p>
            ) : (
              <div className="space-y-2">
                {orderFormItems.map((item, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <select
                      value={item.productId}
                      onChange={(e) => updateOrderItem(i, 'productId', Number(e.target.value))}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value={0}>Seleccionar producto...</option>
                      {products.filter((p) => p.isActive).map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                      ))}
                    </select>
                    <input
                      type="number" min="1" value={item.quantityOrdered}
                      onChange={(e) => updateOrderItem(i, 'quantityOrdered', Number(e.target.value))}
                      className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Cant."
                    />
                    <input
                      type="number" min="0" step="0.01" value={item.unitCost}
                      onChange={(e) => updateOrderItem(i, 'unitCost', Number(e.target.value))}
                      className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      placeholder="Costo"
                    />
                    <button onClick={() => removeOrderItem(i)} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                      <XCircle size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Flete</label>
              <input
                type="number" min="0" step="0.01" value={orderFormFreight}
                onChange={(e) => setOrderFormFreight(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha esperada</label>
              <input
                type="date" value={orderFormExpectedDate}
                onChange={(e) => setOrderFormExpectedDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
            <textarea
              rows={2} value={orderFormNotes}
              onChange={(e) => setOrderFormNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
              placeholder="Notas del pedido..."
            />
          </div>
        </div>
      </Modal>

      {/* ══════════════════════ ORDER DETAIL MODAL ══════════════════════ */}
      <Modal
        isOpen={orderDetailOpen}
        onClose={() => setOrderDetailOpen(false)}
        title={selectedOrder ? `Pedido ${selectedOrder.orderNumber}` : 'Detalle del pedido'}
        size="xl"
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-gray-500">Proveedor</p>
                <p className="text-sm font-medium text-gray-900">{selectedOrder.supplier?.name ?? '\u2014'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Estado</p>
                <StatusBadge status={selectedOrder.status.toLowerCase()} label={STATUS_LABELS[selectedOrder.status]} />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-sm font-bold text-gray-900">{formatCurrency(selectedOrder.total)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Fecha</p>
                <p className="text-sm text-gray-900">{formatDate(selectedOrder.createdAt)}</p>
              </div>
            </div>

            {selectedOrder.expectedDate && (
              <div className="flex items-center gap-1 text-sm text-gray-600">
                <Calendar size={14} />
                <span>Fecha esperada: {formatDate(selectedOrder.expectedDate)}</span>
              </div>
            )}

            {/* Items table */}
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Producto</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Código</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Cant. ordenada</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Cant. recibida</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Costo unit.</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Total</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-200">Recibido</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900 border-b border-gray-100">{item.product.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 border-b border-gray-100">{item.product.code}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 border-b border-gray-100">{item.quantityOrdered}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 border-b border-gray-100">{item.quantityReceived}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 border-b border-gray-100">{formatCurrency(item.unitCost)}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900 border-b border-gray-100">{formatCurrency(item.total)}</td>
                      <td className="px-4 py-3 text-center border-b border-gray-100">
                        {item.received ? (
                          <CheckCircle2 size={16} className="inline text-green-500" />
                        ) : (
                          <XCircle size={16} className="inline text-gray-300" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedOrder.observations && (
              <p className="text-sm text-gray-600"><span className="font-medium">Observaciones:</span> {selectedOrder.observations}</p>
            )}

            {/* Status actions */}
            <div className="flex gap-2 flex-wrap pt-2">
              {selectedOrder.status === 'DRAFT' && (
                <LoadingButton size="sm" onClick={() => handleUpdateStatus(selectedOrder.id, 'CONFIRMED')}>
                  Confirmar pedido
                </LoadingButton>
              )}
              {selectedOrder.status === 'CONFIRMED' && (
                <LoadingButton size="sm" onClick={() => handleUpdateStatus(selectedOrder.id, 'SENT')}>
                  <Send size={14} />
                  Marcar como enviado
                </LoadingButton>
              )}
              {selectedOrder.status === 'SENT' && (
                <LoadingButton size="sm" onClick={() => openReceiveItems(selectedOrder)}>
                  <Package size={14} />
                  Recibir productos
                </LoadingButton>
              )}
              {(selectedOrder.status === 'DRAFT' || selectedOrder.status === 'CONFIRMED' || selectedOrder.status === 'SENT') && (
                <LoadingButton size="sm" variant="danger" onClick={() => handleUpdateStatus(selectedOrder.id, 'CANCELLED')}>
                  <XCircle size={14} />
                  Cancelar pedido
                </LoadingButton>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ══════════════════════ RECEIVE ITEMS MODAL ══════════════════════ */}
      <Modal
        isOpen={receiveModalOpen}
        onClose={() => setReceiveModalOpen(false)}
        title="Recibir productos"
        size="lg"
        footer={
          <>
            <LoadingButton variant="secondary" onClick={() => setReceiveModalOpen(false)}>
              Cancelar
            </LoadingButton>
            <LoadingButton loading={savingReceive} onClick={handleReceiveItems}>
              Confirmar recepción
            </LoadingButton>
          </>
        }
      >
        {selectedOrder && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Ingresa las cantidades recibidas para cada producto del pedido <strong>{selectedOrder.orderNumber}</strong>.
            </p>
            {receiveItems.map((ri, i) => {
              const item = selectedOrder.items.find((it) => it.id === ri.orderItemId);
              if (!item) return null;
              return (
                <div key={ri.orderItemId} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.product.name}</p>
                    <p className="text-xs text-gray-500">Ordenado: {item.quantityOrdered} | Costo: {formatCurrency(item.unitCost)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">Recibido:</label>
                    <input
                      type="number" min="0" max={item.quantityOrdered}
                      value={ri.quantityReceived}
                      onChange={(e) => setReceiveItems((prev) =>
                        prev.map((r, idx) => idx === i ? { ...r, quantityReceived: Number(e.target.value), received: Number(e.target.value) > 0 } : r)
                      )}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <button
                      onClick={() => setReceiveItems((prev) =>
                        prev.map((r, idx) => idx === i ? { ...r, quantityReceived: item.quantityOrdered, received: true } : r)
                      )}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      Completar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* ══════════════════════ DELETE ORDER CONFIRM ══════════════════════ */}
      <Modal
        isOpen={deleteOrderId !== null}
        onClose={() => setDeleteOrderId(null)}
        title="Eliminar pedido"
        size="sm"
        footer={
          <>
            <LoadingButton variant="secondary" onClick={() => setDeleteOrderId(null)}>
              Cancelar
            </LoadingButton>
            <LoadingButton variant="danger" loading={deletingOrder} onClick={handleDeleteOrder}>
              Eliminar
            </LoadingButton>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          ¿Estás seguro de eliminar este pedido? Esta acción no se puede deshacer.
        </p>
      </Modal>
    </div>
  );
}
