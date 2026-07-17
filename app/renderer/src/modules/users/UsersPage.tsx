import { rendererLogger } from '../../shared/utils/rendererLogger';
import { useState, useEffect } from 'react';
import {
  Plus, Pencil, User, Shield, DollarSign, Calendar,
  ToggleLeft, ToggleRight, Users as UsersIcon,
} from 'lucide-react';
import { trpc } from '../../trpc';
import { useAuth } from '../../shared/context/AuthContext';
import { formatDate } from '../../shared/utils/formatters';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { DataTable } from '../../shared/components/DataTable';
import type { Column } from '../../shared/components/DataTable';
import { Modal } from '../../shared/components/Modal';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { StatusBadge } from '../../shared/components/StatusBadge';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { EmptyState } from '../../shared/components/EmptyState';
import type { UserRecord, CreateUserInput, UpdateUserInput } from '../../shared/types/user.types';
import type { UserRole } from '../../shared/types/auth.types';

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Admin',
  CASHIER: 'Cajero',
  SUPERVISOR: 'Supervisor',
};

const ROLE_COLORS: Record<UserRole, string> = {
  ADMIN: 'bg-purple-100 text-purple-700',
  CASHIER: 'bg-blue-100 text-blue-700',
  SUPERVISOR: 'bg-amber-100 text-amber-700',
};

interface UserForm {
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
  hourlyRate: number;
}

const emptyForm: UserForm = { username: '', password: '', fullName: '', role: 'CASHIER', hourlyRate: 0 };

export default function UsersPage(): JSX.Element {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  // Toggle confirm
  const [toggleUserId, setToggleUserId] = useState<number | null>(null);
  const [toggleActive, setToggleActive] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchUsers = async () => {
      if (!user) return;
      try {
        const data = await trpc.users.list.query({ userId: user.id });
        if (!cancelled) setUsers(data as UserRecord[]);
      } catch (err) {
        rendererLogger.error('UsersPage', 'Error fetching users:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchUsers();
    return () => { cancelled = true; };
  }, [user]);

  const openCreate = () => {
    setEditingUser(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (u: UserRecord) => {
    setEditingUser(u);
    setForm({
      username: u.username,
      password: '',
      fullName: u.fullName,
      role: u.role,
      hourlyRate: u.hourlyRate ?? 0,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.username.trim() || !form.fullName.trim()) return;
    if (!editingUser && !form.password.trim()) return;
    if (!user) return;
    setSaving(true);
    try {
      if (editingUser) {
        const data: UpdateUserInput = {
          fullName: form.fullName,
          role: form.role,
          hourlyRate: form.hourlyRate || undefined,
          actorUserId: user.id,
        };
        if (form.password.trim()) data.password = form.password;
        const result = await trpc.users.update.mutate({ id: editingUser.id, data });
        setUsers((prev) => prev.map((u) => (u.id === editingUser.id ? result as UserRecord : u)));
      } else {
        const input: CreateUserInput = {
          username: form.username,
          password: form.password,
          fullName: form.fullName,
          role: form.role,
          hourlyRate: form.hourlyRate || undefined,
          actorUserId: user.id,
        };
        const result = await trpc.users.create.mutate({ data: input });
        setUsers((prev) => [...prev, result as UserRecord]);
      }
      setModalOpen(false);
    } catch (err) {
      rendererLogger.error('UsersPage', 'Error saving user:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (toggleUserId === null || !user) return;
    setToggling(true);
    try {
      const result = await trpc.users.toggleActive.mutate({ id: toggleUserId, active: toggleActive });
      setUsers((prev) => prev.map((u) => (u.id === toggleUserId ? result as UserRecord : u)));
      setToggleUserId(null);
    } catch (err) {
      rendererLogger.error('UsersPage', 'Error toggling user:', err);
    } finally {
      setToggling(false);
    }
  };

  const columns: Column<UserRecord>[] = [
    {
      key: 'username', header: 'Usuario',
      render: (u) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
            <User size={14} className="text-gray-500" />
          </div>
          <span className="font-medium text-gray-900">{u.username}</span>
        </div>
      ),
    },
    {
      key: 'fullName', header: es.users.fullName,
      render: (u) => u.fullName,
    },
    {
      key: 'role', header: es.users.role,
      render: (u) => (
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role]}`}>
          <Shield size={12} />
          {ROLE_LABELS[u.role]}
        </span>
      ),
    },
    {
      key: 'active', header: es.users.status,
      render: (u) => <StatusBadge status={u.active ? 'active' : 'inactive'} label={u.active ? es.users.active : es.users.inactive} />,
    },
    {
      key: 'hourlyRate', header: 'Tarifa por hora',
      render: (u) => u.hourlyRate ? (
        <span className="inline-flex items-center gap-1">
          <DollarSign size={13} className="text-gray-400" />
          {u.hourlyRate.toLocaleString('es-CO')}
        </span>
      ) : '\u2014',
    },
    {
      key: 'createdAt', header: 'Creado',
      render: (u) => (
        <span className="inline-flex items-center gap-1 text-gray-500">
          <Calendar size={13} />
          {formatDate(u.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions', header: 'Acciones', className: 'text-right',
      render: (u) => (
        <div className="flex justify-end gap-2">
          <button
            onClick={() => openEdit(u)}
            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Editar"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => {
              setToggleUserId(u.id);
              setToggleActive(!u.active);
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              u.active
                ? 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                : 'text-gray-500 hover:text-green-600 hover:bg-green-50'
            }`}
            title={u.active ? es.users.deactivate : es.users.activate}
          >
            {u.active ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
          </button>
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
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-violet-700 to-purple-800 p-6 text-white">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24 pointer-events-none" />
        <div className="relative z-10">
          <h1 className="text-2xl font-bold">{es.users.title}</h1>
          <p className="text-violet-200 mt-1">{es.users.subtitle}</p>
        </div>
      </div>

      {/* ── Users Table ── */}
      <Card
        title={es.users.listTitle}
        actions={
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            {es.users.createAction}
          </button>
        }
      >
        {users.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No hay usuarios" description="Crea tu primer usuario para comenzar." />
        ) : (
          <DataTable columns={columns} data={users} keyExtractor={(u) => u.id} />
        )}
      </Card>

      {/* ══════════════════════ USER MODAL ══════════════════════ */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingUser ? es.users.editTitle : es.users.createTitle}
        size="md"
        footer={
          <>
            <LoadingButton variant="secondary" onClick={() => setModalOpen(false)}>
              {es.common.cancel}
            </LoadingButton>
            <LoadingButton loading={saving} onClick={handleSave}>
              {editingUser ? es.common.save : es.users.createAction}
            </LoadingButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{es.auth.username} *</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
              disabled={!!editingUser}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:bg-gray-100 disabled:text-gray-500"
              placeholder="Nombre de usuario"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {es.auth.password} {!editingUser ? '*' : ''}
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              placeholder={editingUser ? 'Dejar vacío para no cambiar' : 'Contraseña'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            />
            {editingUser && <p className="text-xs text-gray-400 mt-1">Deja vacío para mantener la contraseña actual.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{es.users.fullName} *</label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              placeholder="Nombre completo"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{es.users.role} *</label>
            <select
              value={form.role}
              onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as UserRole }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            >
              {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tarifa por hora</label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.hourlyRate}
                onChange={(e) => setForm((p) => ({ ...p, hourlyRate: Number(e.target.value) }))}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                placeholder="0"
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* ══════════════════════ TOGGLE ACTIVE CONFIRM ══════════════════════ */}
      <Modal
        isOpen={toggleUserId !== null}
        onClose={() => setToggleUserId(null)}
        title={toggleActive ? es.users.activate : es.users.deactivate}
        size="sm"
        footer={
          <>
            <LoadingButton variant="secondary" onClick={() => setToggleUserId(null)}>
              {es.common.cancel}
            </LoadingButton>
            <LoadingButton
              variant={toggleActive ? 'primary' : 'danger'}
              loading={toggling}
              onClick={handleToggleActive}
            >
              {toggleActive ? es.users.activate : es.users.deactivate}
            </LoadingButton>
          </>
        }
      >
        <p className="text-sm text-gray-600">
          {toggleActive
            ? '¿Estás seguro de activar este usuario? Podrá acceder al sistema nuevamente.'
            : '¿Estás seguro de desactivar este usuario? No podrá acceder al sistema hasta que sea activado nuevamente.'
          }
        </p>
      </Modal>
    </div>
  );
}
