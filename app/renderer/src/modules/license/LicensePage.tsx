import { useState, useEffect } from 'react';
import { Key, Shield, ShieldCheck, ShieldX, Copy, CheckCircle2, Fingerprint, ChevronRight, AlertTriangle, Clock } from 'lucide-react';
import { trpc } from '../../trpc';
import { es } from '../../shared/i18n';
import { formatDate } from '../../shared/utils/formatters';
import { Card } from '../../shared/components/Card';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';

interface LicenseState {
  status: 'valid' | 'invalid' | 'none';
  fingerprint: string;
  expiresAt?: string;
  daysRemaining?: number;
}

export default function LicensePage(): JSX.Element {
  const [state, setState] = useState<LicenseState>({ status: 'none', fingerprint: '' });
  const [loading, setLoading] = useState(true);
  const [activationKey, setActivationKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [status, hw] = await Promise.all([
          trpc.license.getStatus.query(),
          trpc.license.getFingerprint.query(),
        ]);
        if (cancelled) return;
        setState({
          status: status.status,
          fingerprint: hw.fingerprint,
          expiresAt: status.validation?.expiryDate,
          daysRemaining: status.validation?.daysRemaining,
        });
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const handleCopyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(state.fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showMessage('No se pudo copiar al portapapeles.', 'error');
    }
  };

  const handleActivate = async () => {
    if (!activationKey.trim()) return;
    setActivating(true);
    try {
      const result = await trpc.license.activate.mutate({ activationKey: activationKey.trim() });
      setState((prev) => ({
        ...prev,
        status: 'valid',
        expiresAt: result.expiryDate,
        daysRemaining: result.daysRemaining,
      }));
      setActivationKey('');
      showMessage('Licencia activada correctamente.', 'success');
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Error al activar licencia.', 'error');
    } finally {
      setActivating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <LoadingSpinner size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
          <Key size={16} />
          <span>{es.license.title}</span>
          <ChevronRight size={14} />
          <span className="text-indigo-600 font-semibold">{es.license.subtitle}</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{es.license.title}</h1>
        <p className="text-sm text-gray-500">{es.license.subtitle}</p>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${
          messageType === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      <Card title={es.license.statusTitle}>
        <div className="flex items-start gap-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
            state.status === 'valid' ? 'bg-emerald-100' : 'bg-red-100'
          }`}>
            {state.status === 'valid' ? (
              <ShieldCheck size={32} className="text-emerald-600" />
            ) : (
              <ShieldX size={32} className="text-red-600" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-lg font-semibold text-gray-900 m-0">
                {state.status === 'valid' ? es.license.valid : state.status === 'invalid' ? es.license.invalid : es.license.noLicense}
              </h3>
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                state.status === 'valid' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}>
                {state.status === 'valid' ? (
                  <><CheckCircle2 size={12} /> Activa</>
                ) : (
                  <><ShieldX size={12} /> Inactiva</>
                )}
              </span>
            </div>
            {state.status === 'valid' && state.expiresAt && (
              <div className="flex items-center gap-4 text-sm text-gray-600 mt-2">
                <div className="flex items-center gap-1.5">
                  <Clock size={14} className="text-gray-400" />
                  <span>{es.license.expiryDate}: {formatDate(state.expiresAt)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Shield size={14} className="text-gray-400" />
                  <span>{es.license.daysRemaining}: {state.daysRemaining} días</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card title={es.license.fingerprintTitle}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
            <Fingerprint size={20} className="text-gray-500" />
          </div>
          <code className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 font-mono text-gray-800 select-all">
            {state.fingerprint}
          </code>
          <button
            onClick={handleCopyFingerprint}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors border-none cursor-pointer"
          >
            {copied ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
            {copied ? 'Copiado' : es.license.fingerprintCopy}
          </button>
        </div>
      </Card>

      {state.status === 'none' && (
        <Card title={es.license.activateTitle}>
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{es.license.lockedNotice}</span>
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              value={activationKey}
              onChange={(e) => setActivationKey(e.target.value)}
              placeholder={es.license.activatePlaceholder}
              className="tc-input"
            />
            <LoadingButton onClick={handleActivate} loading={activating} disabled={!activationKey.trim()}>
              <Key size={16} />
              {es.license.activateButton}
            </LoadingButton>
          </div>
        </Card>
      )}

      {state.status === 'valid' && (
        <Card>
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
            <ShieldCheck size={18} />
            <span>Licencia válida. El sistema funciona con normalidad.</span>
          </div>
        </Card>
      )}
    </div>
  );
}
