import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plus, Edit3, User, Phone, Mail, MapPin,
  FileText, DollarSign, CreditCard, X, ClipboardList,
} from 'lucide-react';
import { trpc } from '../../trpc';
import { formatCurrency, formatDate, formatDateTime } from '../../shared/utils/formatters';
import { useAuth } from '../../shared/context/AuthContext';
import { Card } from '../../shared/components/Card';
import { Modal } from '../../shared/components/Modal';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { DataTable } from '../../shared/components/DataTable';
import type { Column } from '../../shared/components/DataTable';

interface Customer {
  id: number;
  document: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface CustomerHistoryItem {
  id: number;
  saleNumber: string;
  total: number;
  createdAt: string;
  status: string;
}

interface CustomerDebt {
  id: number;
  customerId: number;
  saleId: number | null;
  amount: number;
  remaining: number;
  description: string | null;
  createdAt: string;
}

interface CustomerFormData {
  document: string;
  name: string;
  email: string;
  phone: string;
  address: string;
}

const emptyForm: CustomerFormData = { document: '', name: '', email: '', phone: '', address: '' };

type Tab = 'history' | 'debts';

export default function CustomersPage(): JSX.Element {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>(emptyForm);
  const [formLoading, setFormLoading] = useState(false);

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerHistory, setCustomerHistory] = useState<CustomerHistoryItem[]>([]);
  const [customerDebts, setCustomerDebts] = useState<CustomerDebt[]>([]);
  const [detailTab, setDetailTab] = useState<Tab>('history');
  const [detailLoading, setDetailLoading] = useState(false);

  const [payDebtTarget, setPayDebtTarget] = useState<CustomerDebt | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payLoading, setPayLoading] = useState(false);

  const loadCustomers = useCallback(async (query?: string) => {
    try {
      const result = await trpc.customers.search.query({ query: query ?? '' }) as Customer[];
      setCustomers(result ?? []);
    } catch (err) {
      rendererLogger.error('CustomersPage', 'Error loading customers:', err);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    if (!selectedCustomer) {
      setCustomerHistory([]);
      setCustomerDebts([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void (async () => {
      try {
        const result = (await trpc.customers.getHistory.query({ customerId: selectedCustomer.id })) as {
          sales: Array<{ id: number; saleNumber: string; total: number; createdAt: string; status: string }>;
          debts: Array<{ id: number; customerId: number; saleId: number | null; amount: number; balance: number; status: string; createdAt: string }>;
        };
        if (!cancelled) {
          setCustomerHistory(
            (result.sales ?? []).map((s) => ({
              id: s.id,
              saleNumber: s.saleNumber,
              total: s.total,
              createdAt: s.createdAt,
              status: s.status,
            })),
          );
          setCustomerDebts(
            (result.debts ?? []).map((d) => ({
              id: d.id,
              customerId: d.customerId,
              saleId: d.saleId,
              amount: d.amount,
              remaining: d.balance,
              description: null,
              createdAt: d.createdAt,
            })),
          );
        }
      } catch (err) {
        if (!cancelled) {
          rendererLogger.error('CustomersPage', 'Error loading customer detail:', err);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadCustomers(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, loadCustomers]);

  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setFormData(emptyForm);
    setShowForm(true);
  };

  const handleOpenEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      document: customer.document,
      name: customer.name,
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      address: customer.address ?? '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.document.trim() || !formData.name.trim()) return;
    setFormLoading(true);
    try {
      if (editingCustomer) {
        await trpc.customers.update.mutate({ id: editingCustomer.id, data: formData });
      } else {
        await trpc.customers.create.mutate({ data: formData });
      }
      setShowForm(false);
      setFormData(emptyForm);
      setEditingCustomer(null);
      await loadCustomers(searchQuery);
    } catch (err) {
      rendererLogger.error('CustomersPage', 'Error saving customer:', err);
    } finally {
      setFormLoading(false);
    }
  };

  const handlePayDebt = async () => {
    if (!payDebtTarget || !payAmount) return;
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    if (!user) return;
    setPayLoading(true);
    try {
      await trpc.customers.payDebt.mutate({
        debtId: payDebtTarget.id,
        amount,
        userId: user.id,
        cashSessionId: 0,
      });
      setPayDebtTarget(null);
      setPayAmount('');
      if (selectedCustomer) {
        const debts = await trpc.customers.getDebts.query({ customerId: selectedCustomer.id });
        setCustomerDebts((debts as unknown as { debts?: CustomerDebt[] })?.debts ?? []);
      }
    } catch (err) {
      rendererLogger.error('CustomersPage', 'Error paying debt:', err);
    } finally {
      setPayLoading(false);
    }
  };

  const customerColumns: Column<Customer>[] = [
    { key: 'document', header: 'Documento', className: 'font-medium text-gray-900' },
    { key: 'name', header: 'Nombre' },
    {
      key: 'email', header: 'Email',
      render: (row) => row.email ? (
        <span className="flex items-center gap-1.5"><Mail size={14} className="text-gray-400" />{row.email}</span>
      ) : '--',
    },
    {
      key: 'phone', header: 'Teléfono',
      render: (row) => row.phone ? (
        <span className="flex items-center gap-1.5"><Phone size={14} className="text-gray-400" />{row.phone}</span>
      ) : '--',
    },
    {
      key: 'address', header: 'Dirección',
      render: (row) => row.address ? (
        <span className="flex items-center gap-1.5"><MapPin size={14} className="text-gray-400" />{row.address}</span>
      ) : '--',
    },
    {
      key: 'actions', header: 'Acciones',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleOpenEdit(row); }}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
        >
          <Edit3 size={14} />
          Editar
        </button>
      ),
    },
  ];

  const historyColumns: Column<CustomerHistoryItem>[] = [
    {
      key: 'saleNumber', header: 'Venta',
      render: (row) => <span className="font-medium text-indigo-600">#{row.saleNumber}</span>,
    },
    {
      key: 'createdAt', header: 'Fecha',
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'total', header: 'Total',
      render: (row) => <span className="font-semibold">{formatCurrency(row.total)}</span>,
    },
    {
      key: 'status', header: 'Estado',
      render: (row) => {
        const styles: Record<string, string> = {
          COMPLETED: 'bg-green-100 text-green-700',
          CANCELLED: 'bg-red-100 text-red-700',
          PENDING: 'bg-yellow-100 text-yellow-700',
        };
        const labels: Record<string, string> = {
          COMPLETED: 'Completada',
          CANCELLED: 'Cancelada',
          PENDING: 'Pendiente',
        };
        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[row.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {labels[row.status] ?? row.status}
          </span>
        );
      },
    },
  ];

  const debtColumns: Column<CustomerDebt>[] = [
    {
      key: 'description', header: 'Descripción',
      render: (row) => row.description ?? '--',
    },
    {
      key: 'amount', header: 'Monto original',
      render: (row) => formatCurrency(row.amount),
    },
    {
      key: 'remaining', header: 'Saldo pendiente',
      render: (row) => <span className="font-semibold text-red-600">{formatCurrency(row.remaining)}</span>,
    },
    {
      key: 'createdAt', header: 'Fecha',
      render: (row) => formatDate(row.createdAt),
    },
    {
      key: 'actions', header: 'Acciones',
      render: (row) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setPayDebtTarget(row); setPayAmount(String(row.remaining)); }}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
        >
          <DollarSign size={14} />
          Pagar
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
        <p className="text-sm text-gray-500 mt-1">Gestión de clientes, historial de compras y seguimiento de deudas</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Main card */}
        <Card
          title="Listado de clientes"
          subtitle={`${customers.length} cliente${customers.length !== 1 ? 's' : ''} registrado${customers.length !== 1 ? 's' : ''}`}
          actions={
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Plus size={16} />
              Nuevo cliente
            </button>
          }
        >
          {/* Search */}
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por documento, nombre, teléfono..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
            </div>
          ) : customers.length === 0 ? (
            <div className="text-center py-8">
              <User size={40} className="mx-auto text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">
                {searchQuery ? 'No se encontraron clientes con ese criterio de búsqueda' : 'No hay clientes registrados'}
              </p>
              {!searchQuery && (
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  <Plus size={16} />
                  Crear primer cliente
                </button>
              )}
            </div>
          ) : (
            <DataTable
              columns={customerColumns}
              data={customers}
              keyExtractor={(row) => row.id}
              className="cursor-pointer"
            />
          )}
        </Card>

        {/* Customer Detail */}
        {selectedCustomer && (
          <Card
            title={selectedCustomer.name}
            subtitle={`Documento: ${selectedCustomer.document}`}
            actions={
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            }
          >
            {/* Info row */}
            <div className="flex flex-wrap gap-4 mb-4 text-sm">
              {selectedCustomer.phone && (
                <span className="flex items-center gap-1.5 text-gray-600">
                  <Phone size={14} className="text-gray-400" /> {selectedCustomer.phone}
                </span>
              )}
              {selectedCustomer.email && (
                <span className="flex items-center gap-1.5 text-gray-600">
                  <Mail size={14} className="text-gray-400" /> {selectedCustomer.email}
                </span>
              )}
              {selectedCustomer.address && (
                <span className="flex items-center gap-1.5 text-gray-600">
                  <MapPin size={14} className="text-gray-400" /> {selectedCustomer.address}
                </span>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 border-b border-gray-200">
              <button
                type="button"
                onClick={() => setDetailTab('history')}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  detailTab === 'history'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <ClipboardList size={16} className="inline mr-1.5" />
                Historial de compras
              </button>
              <button
                type="button"
                onClick={() => setDetailTab('debts')}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  detailTab === 'debts'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <CreditCard size={16} className="inline mr-1.5" />
                Deudas
                {customerDebts.filter((d) => d.remaining > 0).length > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold text-white bg-red-500 rounded-full">
                    {customerDebts.filter((d) => d.remaining > 0).length}
                  </span>
                )}
              </button>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
              </div>
            ) : detailTab === 'history' ? (
              customerHistory.length === 0 ? (
                <div className="text-center py-6">
                  <FileText size={32} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">Este cliente no tiene compras registradas</p>
                </div>
              ) : (
                <DataTable
                  columns={historyColumns}
                  data={customerHistory}
                  keyExtractor={(row) => row.id}
                />
              )
            ) : (
              customerDebts.length === 0 ? (
                <div className="text-center py-6">
                  <DollarSign size={32} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">Este cliente no tiene deudas pendientes</p>
                </div>
              ) : (
                <DataTable
                  columns={debtColumns}
                  data={customerDebts}
                  keyExtractor={(row) => row.id}
                />
              )
            )}
          </Card>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setFormData(emptyForm); setEditingCustomer(null); }}
        title={editingCustomer ? 'Editar cliente' : 'Nuevo cliente'}
        size="md"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setShowForm(false); setFormData(emptyForm); setEditingCustomer(null); }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <LoadingButton
              onClick={handleSave}
              loading={formLoading}
              disabled={!formData.document.trim() || !formData.name.trim()}
            >
              {editingCustomer ? 'Guardar cambios' : 'Crear cliente'}
            </LoadingButton>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Documento <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.document}
              onChange={(e) => setFormData((prev) => ({ ...prev, document: e.target.value }))}
              placeholder="Número de documento"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Nombre completo"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="correo@ejemplo.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
            <input
              type="text"
              value={formData.phone}
              onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="Número de teléfono"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
              placeholder="Dirección física"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
        </div>
      </Modal>

      {/* Pay Debt Modal */}
      <Modal
        isOpen={!!payDebtTarget}
        onClose={() => { setPayDebtTarget(null); setPayAmount(''); }}
        title="Pagar deuda"
        size="sm"
        footer={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setPayDebtTarget(null); setPayAmount(''); }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <LoadingButton
              onClick={handlePayDebt}
              loading={payLoading}
              disabled={!payAmount || Number(payAmount) <= 0}
              variant="primary"
            >
              Pagar
            </LoadingButton>
          </div>
        }
      >
        {payDebtTarget && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Deuda original</span>
                <span className="font-semibold">{formatCurrency(payDebtTarget.amount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Saldo pendiente</span>
                <span className="font-semibold text-red-600">{formatCurrency(payDebtTarget.remaining)}</span>
              </div>
              {payDebtTarget.description && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Descripción</span>
                  <span className="text-gray-700">{payDebtTarget.description}</span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto a pagar</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max={payDebtTarget.remaining}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
