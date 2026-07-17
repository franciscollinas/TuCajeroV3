import { memo } from 'react';
import { X, Info, Award } from 'lucide-react';

interface AboutModalProps { open: boolean; onClose: () => void; }

export const AboutModal = memo(function AboutModal({ open, onClose }: AboutModalProps): JSX.Element | null {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl max-w-md w-[90%] overflow-hidden shadow-2xl"
        style={{ animation: 'slideUp 0.3s ease' }}>
        <div className="bg-gradient-to-br from-purple-500 to-indigo-600 px-6 pt-8 pb-6 text-center text-white relative">
          <button onClick={onClose} className="absolute top-3 right-3 bg-white/20 border-none rounded-full w-8 h-8 flex items-center justify-center text-white cursor-pointer hover:bg-white/30">
            <X size={16} />
          </button>
          <div className="w-20 h-20 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center mx-auto mb-4 border-2 border-white/25">
            <img src="/isotipo.png" alt="TuCajero" className="w-14 h-14 object-contain" />
          </div>
          <h2 className="text-2xl font-extrabold m-0">TuCajero</h2>
          <p className="text-sm opacity-85 mt-1">Sistema Punto de Venta para Pequeños Negocios</p>
          <p className="text-xs opacity-70 mt-0.5">Versión 3.0.0</p>
        </div>
        <div className="p-6">
          <div className="bg-gray-50 rounded-lg p-4 mb-5 border border-gray-200 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1.5">
              <Award size={16} className="text-purple-500" />
              <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">Diseñado y Desarrollado por</span>
            </div>
            <p className="text-sm font-bold text-gray-800 m-0">Ing. Francisco Llinas Pisciotti</p>
            <p className="text-xs text-gray-500 mt-0.5">© 2026 — Todos los derechos reservados</p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 text-sm text-gray-600"><Info size={16} className="text-indigo-400 shrink-0" /><span>Bun + Electron + React + TypeScript</span></div>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400 shrink-0">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
              <span>Drizzle + SQLite — Base de datos local</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400 shrink-0">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              <span>Sistema de licencia y respaldo incluido</span>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400 m-0">Sistema diseñado por el Ingeniero Francisco Llinas Pisciotti — 2026</p>
        </div>
      </div>
    </div>
  );
});
