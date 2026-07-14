import { useState, useEffect, type FormEvent } from 'react';
import { Settings, Save, Building2, Mail, Phone, Hash, Percent, MapPin } from 'lucide-react';
import { trpc } from '../../trpc';
import { es } from '../../shared/i18n';
import { Card } from '../../shared/components/Card';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';

interface BusinessInfo {
  businessName: string;
  address: string;
  email: string;
  phone: string;
  nit: string;
  logo: string;
  ivaRate: number;
}

export default function SettingsPage(): JSX.Element {
  const [form, setForm] = useState<BusinessInfo>({
    businessName: '',
    address: '',
    email: '',
    phone: '',
    nit: '',
    logo: '',
    ivaRate: 19,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  useEffect(() => {
    let cancelled = false;
    const fetchBusiness = async () => {
      try {
        const result = await trpc.config.getBusiness.query();
        if (!cancelled && result) {
          const data = result as BusinessInfo;
          setForm({
            businessName: data.businessName ?? '',
            address: data.address ?? '',
            email: data.email ?? '',
            phone: data.phone ?? '',
            nit: data.nit ?? '',
            logo: data.logo ?? '',
            ivaRate: data.ivaRate ?? 19,
          });
        }
      } catch {
        // use defaults
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchBusiness();
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await trpc.config.setBusiness.mutate({ config: form });
      setMessageType('success');
      setMessage('Datos del negocio guardados correctamente.');
    } catch (err) {
      setMessageType('error');
      setMessage(err instanceof Error ? err.message : 'Error al guardar la configuración.');
    } finally {
      setSaving(false);
    }
    setTimeout(() => setMessage(''), 4000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
          <Settings size={16} />
          <span>{es.settings.title}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{es.settings.title}</h1>
        <p className="text-sm text-gray-500">{es.settings.business.subtitle}</p>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
          messageType === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Card title={es.settings.business.title} subtitle={es.settings.business.subtitle}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                <Building2 size={14} className="text-gray-400" />
                Nombre del negocio
              </label>
              <input
                type="text"
                value={form.businessName}
                onChange={(e) => setForm((prev) => ({ ...prev, businessName: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="TuCajero"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                <Hash size={14} className="text-gray-400" />
                NIT
              </label>
              <input
                type="text"
                value={form.nit}
                onChange={(e) => setForm((prev) => ({ ...prev, nit: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="123456789-0"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                <Mail size={14} className="text-gray-400" />
                Correo electrónico
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="info@tucajero.com"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                <Phone size={14} className="text-gray-400" />
                Teléfono
              </label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="+57 300 123 4567"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                <MapPin size={14} className="text-gray-400" />
                Dirección
              </label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Cra 1 # 2-3"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                <Percent size={14} className="text-gray-400" />
                IVA (%) 
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.ivaRate}
                onChange={(e) => setForm((prev) => ({ ...prev, ivaRate: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                <Building2 size={14} className="text-gray-400" />
                Logo (URL o ruta)
              </label>
              <input
                type="text"
                value={form.logo}
                onChange={(e) => setForm((prev) => ({ ...prev, logo: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="ruta/al/logo.png"
              />
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200 flex justify-end">
            <LoadingButton type="submit" loading={saving}>
              <Save size={16} />
              {es.common.save}
            </LoadingButton>
          </div>
        </Card>
      </form>
    </div>
  );
}
