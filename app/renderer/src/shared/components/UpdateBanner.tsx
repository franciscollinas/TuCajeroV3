import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { es } from '../i18n';

type UpdateState =
  | { status: 'idle' }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'downloaded'; version: string };

export function UpdateBanner(): JSX.Element | null {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api) return;
    window.api.onUpdateAvailable((info) => {
      setDismissed(false);
      setState({ status: 'downloading', version: info.version, percent: 0 });
    });
    window.api.onUpdateProgress((progress) => {
      setState((prev) => (prev.status === 'downloading' ? { ...prev, percent: progress.percent } : prev));
    });
    window.api.onUpdateDownloaded(() => {
      setState((prev) => (prev.status === 'downloading' ? { status: 'downloaded', version: prev.version } : prev));
    });
    window.api.onUpdateNotAvailable(() => setState({ status: 'idle' }));
    window.api.onUpdateError(() => setState({ status: 'idle' }));
  }, []);

  if (state.status === 'idle' || dismissed) return null;

  const handleRestart = async () => {
    await window.api.installUpdate();
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl bg-white shadow-2xl border border-gray-200 overflow-hidden"
      style={{ animation: 'slideUp 0.3s ease' }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white shrink-0">
          <Download size={18} />
        </div>
        <div className="flex-1 min-w-0">
          {state.status === 'downloading' && (
            <>
              <p className="text-sm font-bold text-gray-800 m-0">
                {es.updater.downloading.replace('{version}', state.version)}
              </p>
              <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-indigo-600 transition-all duration-300"
                  style={{ width: `${Math.round(state.percent)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1 m-0">{Math.round(state.percent)}%</p>
            </>
          )}
          {state.status === 'downloaded' && (
            <>
              <p className="text-sm font-bold text-gray-800 m-0">
                {es.updater.downloaded.replace('{version}', state.version)}
              </p>
              <p className="text-xs text-gray-500 mt-1 m-0">{es.updater.installOnQuit}</p>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleRestart}
                  className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-xs font-bold cursor-pointer border-none hover:opacity-90"
                >
                  {es.updater.restartNow}
                </button>
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-bold cursor-pointer border-none hover:bg-gray-200"
                >
                  {es.updater.later}
                </button>
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="border-none bg-transparent text-gray-400 cursor-pointer hover:text-gray-600 shrink-0"
          aria-label={es.common.close}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}