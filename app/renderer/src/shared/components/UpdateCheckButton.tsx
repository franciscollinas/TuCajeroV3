import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { es } from '../i18n';
import type { UpdateCheckOutcome } from '../types/update.types';

const withVersion = (text: string, version: string): string => text.replace('{version}', version);

function messageFor(outcome: UpdateCheckOutcome): string {
  switch (outcome.status) {
    case 'up-to-date':
      return withVersion(es.updater.upToDate, outcome.version);
    case 'available':
      return withVersion(es.updater.available, outcome.version);
    case 'downloaded':
      return withVersion(es.updater.alreadyDownloaded, outcome.version);
    case 'unavailable':
      return es.updater.unavailable;
    case 'error':
      return es.updater.checkError;
  }
}

/** Botón «Buscar actualizaciones» (Dashboard). Si hay versión nueva se descarga sola y sale el aviso de siempre. */
export function UpdateCheckButton(): JSX.Element {
  const [version, setVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api
      ?.getAppVersion?.()
      .then((value) => { if (!cancelled) setVersion(value); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const handleClick = async (): Promise<void> => {
    setChecking(true);
    setMessage(null);
    try {
      setMessage(messageFor(await window.api.checkForUpdates()));
    } catch {
      setMessage(es.updater.checkError);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={checking}
        aria-busy={checking}
        className="inline-flex items-center gap-2 px-4 py-2 bg-white/15 hover:bg-white/25 rounded-lg text-sm font-medium transition-colors disabled:opacity-70 disabled:cursor-wait"
      >
        <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
        {checking ? es.updater.checking : es.updater.checkNow}
      </button>
      {message ? (
        <p role="status" aria-live="polite" className="m-0 max-w-[320px] text-right text-xs text-indigo-100">
          {message}
        </p>
      ) : (
        version && <p className="m-0 text-xs text-indigo-200">{withVersion(es.updater.version, version)}</p>
      )}
    </div>
  );
}
