import { useTranslation } from 'react-i18next';
import Modal from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  isDestructive = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const resolvedConfirmText = confirmText ?? t('common.confirm');
  const resolvedCancelText = cancelText ?? t('common.cancel');

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-6">
        <p className="text-gray-700 dark:text-gray-300">{message}</p>

        <div className="flex gap-3">
          {resolvedCancelText && (
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 rounded-lg border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-center text-2xl"
              title={resolvedCancelText}
            >
              ✕
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            className={`flex-1 h-12 rounded-lg text-white transition-colors flex items-center justify-center text-2xl ${
              isDestructive
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-primary-500 hover:bg-primary-600'
            }`}
            title={resolvedConfirmText}
          >
            {isDestructive ? '🗑️' : '✓'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
