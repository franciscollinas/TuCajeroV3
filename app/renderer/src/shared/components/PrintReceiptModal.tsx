import { useState } from 'react';
import { Printer, X, CheckCircle } from 'lucide-react';
import { Modal } from './Modal';

export interface PrintReceiptModalProps {
  isOpen: boolean;
  saleNumber: string;
  onPrint: (shouldPrint: boolean) => Promise<void>;
}

export function PrintReceiptModal({ isOpen, saleNumber, onPrint }: PrintReceiptModalProps): JSX.Element {
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async (yes: boolean) => {
    if (printing) return;
    setPrinting(true);
    setError(null);
    try {
      await onPrint(yes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al imprimir.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => !printing && handle(false)} size="sm">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-5)',
          padding: 'var(--space-2) 0',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 'var(--radius-2xl)',
            background: 'linear-gradient(135deg, var(--brand-500), var(--brand-600))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(99,102,241,0.35)',
            animation: 'pulse 2s ease-in-out infinite',
          }}
        >
          <Printer size={34} color="#fff" />
        </div>

        <div>
          <h3
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 800,
              color: 'var(--gray-900)',
              margin: '0 0 var(--space-2)',
            }}
          >
            ¿Imprimir factura?
          </h3>
          <p style={{ color: 'var(--gray-500)', fontSize: 'var(--text-sm)', margin: 0 }}>
            Venta{' '}
            <span style={{ fontWeight: 700, color: 'var(--brand-600)' }}>#{saleNumber}</span>{' '}
            completada exitosamente
          </p>
          <p style={{ color: 'var(--gray-400)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
            El recibo se enviará a la impresora configurada
          </p>
        </div>

        {error && (
          <p style={{ color: '#ef4444', fontSize: 'var(--text-sm)', margin: 0, padding: 'var(--space-2) var(--space-3)', background: '#fef2f2', borderRadius: 'var(--radius-md)', width: '100%' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-3)', width: '100%' }}>
          <button
            id="print-receipt-no"
            onClick={() => handle(false)}
            disabled={printing}
            style={{
              flex: 1,
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-lg)',
              border: '2px solid var(--gray-200)',
              background: printing ? 'var(--gray-50)' : '#fff',
              color: 'var(--gray-600)',
              fontWeight: 700,
              fontSize: 'var(--text-sm)',
              cursor: printing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              transition: 'all var(--transition-fast)',
              opacity: printing ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!printing) {
                e.currentTarget.style.background = 'var(--gray-50)';
                e.currentTarget.style.borderColor = 'var(--gray-300)';
              }
            }}
            onMouseLeave={(e) => {
              if (!printing) {
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.borderColor = 'var(--gray-200)';
              }
            }}
          >
            <X size={16} />
            No, continuar
          </button>

          <button
            id="print-receipt-yes"
            onClick={() => handle(true)}
            disabled={printing}
            style={{
              flex: 1,
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-lg)',
              border: 'none',
              background: printing
                ? 'var(--success)'
                : 'linear-gradient(135deg, #10b981, #059669)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 'var(--text-sm)',
              cursor: printing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              transition: 'all var(--transition-fast)',
              boxShadow: printing ? 'none' : '0 4px 12px rgba(16,185,129,0.4)',
            }}
            onMouseEnter={(e) => {
              if (!printing) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(16,185,129,0.5)';
              }
            }}
            onMouseLeave={(e) => {
              if (!printing) {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(16,185,129,0.4)';
              }
            }}
          >
            {printing ? (
              <>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    animation: 'spin 0.7s linear infinite',
                    display: 'inline-block',
                  }}
                />
                Imprimiendo...
              </>
            ) : (
              <>
                <CheckCircle size={16} />
                Sí, imprimir
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
