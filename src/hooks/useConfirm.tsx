import { useState, useCallback } from 'react';
import ConfirmDialog from '../components/common/ConfirmDialog';

interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

interface ConfirmState {
  isOpen: boolean;
  message: string;
  title: string;
  options: ConfirmOptions;
  resolve: ((v: boolean) => void) | null;
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false, message: '', title: '', options: {}, resolve: null,
  });

  const confirm = useCallback((message: string, options: ConfirmOptions = {}): Promise<boolean> => {
    return new Promise(resolve => {
      setState({ isOpen: true, message, title: options.title || '', options, resolve });
    });
  }, []);

  const handleClose = () => {
    setState(s => { s.resolve?.(false); return { ...s, isOpen: false, resolve: null }; });
  };

  const handleConfirm = () => {
    setState(s => { s.resolve?.(true); return { ...s, isOpen: false, resolve: null }; });
  };

  const dialog = (
    <ConfirmDialog
      isOpen={state.isOpen}
      onClose={handleClose}
      onConfirm={handleConfirm}
      title={state.title}
      message={state.message}
      confirmText={state.options.confirmText}
      cancelText={state.options.cancelText}
      isDestructive={state.options.isDestructive}
    />
  );

  return { confirm, dialog };
}
