import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { LoadingButton } from './LoadingButton';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
}

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', variant = 'danger', loading }: ConfirmDialogProps): JSX.Element {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="text-center">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${variant === 'danger' ? 'bg-red-100' : 'bg-yellow-100'}`}>
          <AlertTriangle size={28} className={variant === 'danger' ? 'text-red-600' : 'text-yellow-600'} />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
      </div>
      <div className="flex justify-center gap-3">
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 border-none cursor-pointer">{cancelLabel}</button>
        <LoadingButton onClick={onConfirm} variant={variant === 'warning' ? 'primary' : variant} loading={loading}>{confirmLabel}</LoadingButton>
      </div>
    </Modal>
  );
}
