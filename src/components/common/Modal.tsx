import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBackdropClick?: () => void;
  title: string | ReactNode;
  children: ReactNode;
  noBottomOffset?: boolean; // per pagine senza bottom nav (es. SettingsPage)
}

// Stack globale per gestire modal annidati: solo il modal più in alto risponde al back
const _stack: Array<{ id: number; notifyBack: () => void; onClose: () => void }> = [];
let _nextId = 0;
let _ignorePopStateCount = 0; // contatore per gestire più history.back() consecutivi

function _deactivate() {
  window.removeEventListener('popstate', _onPopState);
  window.removeEventListener('trackr:swipe-back', _onSwipeBack);
  document.body.style.overflow = '';
}

function _activate() {
  _ignorePopStateCount = 0; // reset ad ogni nuova sessione di modal
  window.addEventListener('popstate', _onPopState);
  window.addEventListener('trackr:swipe-back', _onSwipeBack);
}

function _onPopState() {
  if (_ignorePopStateCount > 0) { _ignorePopStateCount--; return; }
  // Rimuovi subito dallo stack per prevenire double-close se arriva un altro popstate
  const top = _stack.pop();
  if (!top) return;
  top.notifyBack();
  top.onClose();
  if (_stack.length === 0) _deactivate();
}

function _onSwipeBack() {
  const top = _stack.pop();
  if (!top) return;
  // Browser non è ancora andato indietro: lo facciamo noi e ignoriamo il popstate risultante
  if (window.history.state?.modalBackIntercept) {
    _ignorePopStateCount++;
    window.history.back();
  }
  top.notifyBack();
  top.onClose();
  if (_stack.length === 0) _deactivate();
}

// Registra un handler back esterno (es. stati interni a un form)
// Restituisce la funzione di cleanup da chiamare nel useEffect
export function registerBackHandler(onBack: () => void): () => void {
  const id = ++_nextId;
  let closedViaBack = false;

  _stack.push({
    id,
    notifyBack: () => { closedViaBack = true; },
    onClose: onBack,
  });

  if (_stack.length === 1) {
    _activate();
  }
  window.history.pushState({ modalBackIntercept: true }, '');

  return () => {
    const idx = _stack.findIndex(m => m.id === id);
    if (idx !== -1) _stack.splice(idx, 1);
    const listenersActive = _stack.length > 0;
    if (!listenersActive) _deactivate();
    if (!closedViaBack && window.history.state?.modalBackIntercept) {
      if (listenersActive) _ignorePopStateCount++; // incrementa solo se c'è un listener attivo che lo consumerà
      window.history.back();
    }
  };
}

export default function Modal({ isOpen, onClose, onBackdropClick, title, children, noBottomOffset }: ModalProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closedViaBackRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    const id = ++_nextId;
    closedViaBackRef.current = false;
    document.body.style.overflow = 'hidden';
    window.history.pushState({ modalBackIntercept: true }, '');

    _stack.push({
      id,
      onClose: () => onCloseRef.current(),
      notifyBack: () => { closedViaBackRef.current = true; },
    });

    if (_stack.length === 1) _activate();

    return () => {
      const idx = _stack.findIndex(m => m.id === id);
      if (idx !== -1) _stack.splice(idx, 1);
      const listenersActive = _stack.length > 0;
      if (!listenersActive) _deactivate();
      if (!closedViaBackRef.current && window.history.state?.modalBackIntercept) {
        if (listenersActive) _ignorePopStateCount++;
        window.history.back();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      data-no-swipe
      className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50"
        onClick={onBackdropClick || onClose}
      />

      {/* Modal Content */}
      <div
        className="relative bg-white dark:bg-gray-800 w-full sm:max-w-lg sm:rounded-lg rounded-t-2xl overflow-y-auto animate-slide-up"
        style={{
          maxHeight: '90vh',
          marginBottom: noBottomOffset ? 0 : 'calc(4rem + env(safe-area-inset-bottom, 0px))'
        }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
