import { ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = { sm: 400, md: 500, lg: 640, xl: 800 };

export function Modal({ isOpen, onClose, title, children, footer, size = 'md', className = '' }: ModalProps): JSX.Element | null {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Siempre la última versión de onClose. La mayoría de las pantallas la pasan escrita en línea
  // (una función nueva en cada dibujado); si el efecto dependiera de ella, se repetiría con cada letra
  // que se escribe en un campo y el foco saltaría al botón de cerrar.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    // El foco inicial va al primer campo del formulario; si no hay campos, al primer elemento enfocable.
    const modal = modalRef.current;
    if (modal) {
      const firstField = modal.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
      const firstFocusable = modal.querySelector<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
      (firstField ?? firstFocusable ?? modal).focus();
    }

    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center tc-overlay-glass animate-fadeIn p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Diálogo'}
    >
      <div
        ref={modalRef}
        className={`tc-card tc-aurora-frame animate-scaleIn ${className}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        style={{
          background: '#fff',
          borderRadius: 'var(--radius-2xl)',
          maxWidth: sizeMap[size],
          width: '100%',
          maxHeight: '90vh',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-2xl)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
        }}
      >
        {title && (
          <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 bg-gradient-surface">
            <h3 className="tc-display text-lg font-semibold text-gray-900 m-0">{title}</h3>
            <button onClick={onClose} className="bg-transparent border-none cursor-pointer p-1 text-gray-400 flex" aria-label="Cerrar"><X size={20} /></button>
          </div>
        )}
        <div className="px-6 py-6 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}
