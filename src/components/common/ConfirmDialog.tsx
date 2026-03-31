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
  noBottomOffset?: boolean;
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
  noBottomOffset = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const resolvedConfirmText = confirmText ?? t('common.confirm');
  const resolvedCancelText = cancelText === undefined ? undefined : (cancelText ?? t('common.cancel'));

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} noBottomOffset={noBottomOffset}>
      <div className="space-y-6">
        <p className="text-gray-700 dark:text-gray-300">{message}</p>

        <div className="flex gap-3">
          {resolvedCancelText && (
            <button type="button" onClick={onClose} className="flex-1 btn-secondary">
              {resolvedCancelText}
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            className={`flex-1 px-4 py-3 rounded-lg font-medium text-white transition-colors ${
              isDestructive ? 'bg-red-500 hover:bg-red-600' : 'bg-primary-500 hover:bg-primary-600'
            }`}
          >
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
