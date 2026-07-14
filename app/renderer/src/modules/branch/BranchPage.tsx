import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useState, useEffect } from 'react';
import { Plus, Pencil, Building2, MapPin, Phone, Hash } from 'lucide-react';
import { trpc } from '../../trpc';
import { formatDate } from '../../shared/utils/formatters';
import { Card } from '../../shared/components/Card';
import { DataTable } from '../../shared/components/DataTable';
import type { Column } from '../../shared/components/DataTable';
import { Modal } from '../../shared/components/Modal';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { EmptyState } from '../../shared/components/EmptyState';
import type { Branch } from '../../shared/types/branch.types';

interface BranchForm {
  name: string;
  code: string;
  address: string;
  phone: string;
}

const emptyForm: BranchForm = { name: '', code: '', address: '', phone: '' };

export default function BranchPage(): JSX.Element {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const data = await trpc.branches.listAll.query();
        if (!cancelled) setBranches(data as Branch[]);
      } catch (err) {
        rendererLogger.error('BranchPage', 'Error fetching branches:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  const openCreate = () => {
    setEditingBranch(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (b: Branch) => {
    setEditingBranch(b);
    setForm({ name: b.name, code: b.code, address: b.address ?? '', phone: b.phone ?? '' });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) return;
    setSaving(true);
    try {
      if (editingBranch) {
        const result = await trpc.branches.update.mutate({
          id: editingBranch.id,
          data: { name: form.name, code: form.code, address: form.address || undefined, phone: form.phone || undefined },
        });
        setBranches((prev) => prev.map((b) => (b.id === editingBranch.id ? result as Branch : b)));
      } else {
        const result = await trpc.branches.create.mutate({
          data: { name: form.name, code: form.code, address: form.address || undefined, phone: form.phone || undefined },
        });
        setBranches((prev) => [...prev, result as Branch]);
      }
      setModalOpen(false);
    } catch (err) {
      rendererLogger.error('BranchPage', 'Error saving branch:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    setDeleting(true);
    try {
      await trpc.branches.delete.mutate({ id: deleteId });
      setBranches((prev) => prev.map((b) => b.id === deleteId ? { ...b, isActive: false } as Branch : b));
      setDeleteId(null);
    } catch (err) {
      rendererLogger.error('BranchPage', 'Error deleting branch:', err);
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<Branch>[] = [
    {
      key: 'name', header: 'Nombre',
      render: (b) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <Building2 size={14} className="text-gray-500" />
          </div>
          <div>
            <span className={`font-medium ${b.isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{b.name}</span>
            <span className="block text-xs text-gray-400">{b.code}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'address', header: 'Dirección',
      render: (b) => b.address ? (
        <span className="inline-flex items-center gap-1 text-sm text-gray-600">
          <MapPin size={13} className="text-gray-400" />
          {b.address}
        </span>
      ) : '\u2014',
    },
    {
      key: 'phone', header: 'Teléfono',
      render: (b) => b.phone ? (
        <span className="inline-flex items-center gap-1 text-sm text-gray-600">
          <Phone size={13} className="text-gray-400" />
          {b.phone}
        </span>
      ) : '\u2014',
    },
    {
      key: 'createdAt', header: 'Creado',
      render: (b) => (
        <span className="inline-flex items-center gap-1 text-sm text-gray-500">
          {formatDate(b.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions', header: 'Acciones', className: 'text-right',
      render: (b) => (
        <div className="flex justify-end gap-2">
          <button
            onClick={() => openEdit(b)}
            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Editar"
          >
            <Pencil size={15} />
          </button>
          {b.isActive && (
            <button
              onClick={() => setDeleteId(b.id)}
              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Desactivar"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
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
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-violet-700 to-purple-800 p-6 text-white">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24 pointer-events-none" />
        <div className="relative z-10">
          <h1 className="text-2xl font-bold">Sucursales</h1>
          <p className="text-violet-200 mt-1">Administra las sucursales de tu negocio.</p>
        </div>
      </div>

      <Card
        title="Listado de sucursales"
        actions={
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            Nueva sucursal
          </button>
        }
      >
        {branches.length === 0 ? (
          <EmptyState icon={Building2} title="No hay sucursales" description="Crea tu primera sucursal para comenzar." />
        ) : (
          <DataTable columns={columns} data={branches} keyExtractor={(b) => b.id} />
        )}
      </Card>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingBranch ? 'Editar sucursal' : 'Nueva sucursal'}
        size="md"
        footer={
          <>
            <LoadingButton variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </LoadingButton>
            <LoadingButton loading={saving} onClick={handleSave}>
              {editingBranch ? 'Guardar cambios' : 'Crear sucursal'}
            </LoadingButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              placeholder="Ej: Sucursal Centro"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Código *</label>
            <div className="relative">
              <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                disabled={!!editingBranch}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="Ej: SUC-CENTRO"
              />
            </div>
            {editingBranch && <p className="text-xs text-gray-400 mt-1">El código no se puede modificar después de crear la sucursal.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
            <div className="relative">
              <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                placeholder="Dirección de la sucursal"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
            <div className="relative">
              <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                placeholder="Teléfono de contacto"
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Desactivar sucursal"
        size="sm"
        footer={
          <>
            <LoadingButton variant="secondary" onClick={() => setDeleteId(null)}>
              Cancelar
            </LoadingButton>
            <LoadingButton variant="danger" loading={deleting} onClick={handleDelete}>
              Desactivar
            </LoadingButton>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          ¿Estás seguro de desactivar esta sucursal? Los datos históricos se conservarán pero no podrá ser seleccionada para nuevas operaciones.
        </p>
      </Modal>
    </div>
  );
}
