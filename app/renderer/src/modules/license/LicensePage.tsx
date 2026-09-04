import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Key, Shield, ShieldCheck, ShieldX, Copy, CheckCircle2, Fingerprint, ChevronRight, AlertTriangle, Clock, Lock } from 'lucide-react';
import { trpc } from '../../trpc';
import { es } from '../../shared/i18n';
import { formatDate } from '../../shared/utils/formatters';
import { Card } from '../../shared/components/Card';
import { LoadingButton } from '../../shared/components/LoadingButton';
import { LoadingSpinner } from '../../shared/components/LoadingSpinner';
import { useLicense } from '../../shared/context/LicenseContext';
import { useAuth } from '../../shared/context/AuthContext';

export default function LicensePage(): JSX.Element {
  const { user } = useAuth();
  const { licenseInfo: info, isLoading, isValid, isTrial, isBlocked, refresh } = useLicense();
  const navigate = useNavigate();

  const [fingerprint, setFingerprint] = useState('');
  const [activationKey, setActivationKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  const isAdmin = user?.role === 'ADMIN';

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(''), 4000);
  };

  useEffect(() => {
    let cancelled = false;
    trpc.license.getFingerprint.query()
      .then((hw) => {
        if (!cancelled) setFingerprint(hw.fingerprint);
      })
      .catch(() => {
        // silent
      });
    return () => { cancelled = true; };
  }, []);

  const handleCopyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showMessage('No se pudo copiar al portapapeles.', 'error');
    }
  };

  const handleActivate = async () => {
    if (!activationKey.trim()) return;
    const wasBlocked = isBlocked;
    setActivating(true);
    try {
      await trpc.license.activate.mutate({ activationKey: activationKey.trim() });
      setActivationKey('');
      showMessage(es.license.activateSuccess, 'success');
      await refresh();
      if (wasBlocked) navigate('/dashboard', { replace: true });
    } catch (err) {
      showMessage(err instanceof Error ? err.message : es.license.activateError.replace('{reason}', 'Error desconocido'), 'error');
    } finally {
      setActivating(false);
    }
  };

  if (isLoading) {
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

      {isBlocked && (
        <div className="px-4 py-3 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200 flex items-start gap-2">
          <Lock size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">{es.license.blockedTitle}</div>
            <div>{es.license.lockMessage}</div>
          </div>
        </div>
      )}

      <Card title={es.license.statusTitle}>
        <div className="flex items-start gap-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${
            isValid ? 'bg-emerald-100' : isTrial ? 'bg-amber-100' : 'bg-red-100'
          }`}>
            {isValid ? (
              <ShieldCheck size={32} className="text-emerald-600" />
            ) : isTrial ? (
              <Clock size={32} className="text-amber-600" />
            ) : (
              <ShieldX size={32} className="text-red-600" />
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-lg font-semibold text-gray-900 m-0">
                {isValid ? es.license.valid : isTrial ? es.license.trialActive : isBlocked ? es.license.blockedTitle : es.license.noLicense}
              </h3>
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                isValid ? 'bg-emerald-100 text-emerald-700' : isTrial ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
              }`}>
                {isValid ? (
                  <><CheckCircle2 size={12} /> {es.license.active}</>
                ) : isTrial ? (
                  <><Clock size={12} /> {es.license.trialActive}</>
                ) : (
                  <><ShieldX size={12} /> {es.license.inactive}</>
                )}
              </span>
            </div>

            {isValid && info?.validation?.expiryDate && (
              <div className="flex items-center gap-4 text-sm text-gray-600 mt-2">
                <div className="flex items-center gap-1.5">
                  <Clock size={14} className="text-gray-400" />
                  <span>{es.license.expiryDate}: {formatDate(info.validation.expiryDate)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Shield size={14} className="text-gray-400" />
                  <span>{es.license.daysRemaining}: {info.validation.daysRemaining} días</span>
                </div>
              </div>
            )}

            {isTrial && info?.trial && (
              <div className="mt-2 text-sm text-amber-800">
                <div className="flex items-center gap-2">
                  <Clock size={14} className="text-amber-600" />
                  <span>{es.license.trialRemaining}:</span>
                  <span className="font-semibold">
                    {info.trial.trialRemainingHours}{es.license.trialHours} {info.trial.trialRemainingMinutes}{es.license.trialMinutes}
                  </span>
                </div>
                <p className="mt-1 text-xs italic">{es.license.trialNotice}</p>
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
            {fingerprint}
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

      {isAdmin ? (
        <Card title={es.license.activateTitle}>
          {!isValid && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{es.license.lockedNotice}</span>
            </div>
          )}
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
      ) : !isValid && (
        <Card>
          <div className="flex items-start gap-2 text-sm text-gray-600">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{es.license.lockMessage}</span>
          </div>
        </Card>
      )}

      {isValid && (
        <Card>
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
            <ShieldCheck size={18} />
            <span>{es.license.validNotice}</span>
          </div>
        </Card>
      )}
    </div>
  );
}
