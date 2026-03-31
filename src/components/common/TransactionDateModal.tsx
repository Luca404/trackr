import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecurringFrequency } from '../../types';
import Modal from './Modal';

interface TransactionDateModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: string;
  onDateChange: (date: string) => void;
  allowRecurring?: boolean;
  recurrence?: RecurringFrequency | null;
  onRecurrenceChange?: (frequency: RecurringFrequency | null) => void;
}

export default function TransactionDateModal({
  isOpen,
  onClose,
  date,
  onDateChange,
  allowRecurring = false,
  recurrence = null,
  onRecurrenceChange,
}: TransactionDateModalProps) {
  const { t } = useTranslation();
  const dateInputRef = useRef<HTMLInputElement>(null);

  const handleQuickSelect = (option: 'today' | 'yesterday') => {
    const today = new Date();
    if (option === 'today') {
      onDateChange(today.toISOString().split('T')[0]);
    } else {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      onDateChange(yesterday.toISOString().split('T')[0]);
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('transactions.selectDate')}>
      <div className="space-y-2">
        <button type="button" onClick={() => handleQuickSelect('today')} className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 transition-colors">
          <span className="text-2xl">📅</span>
          <div className="flex-1 text-left">
            <div className="font-medium text-gray-900 dark:text-gray-100">{t('transactions.today')}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">{new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          </div>
        </button>
        <button type="button" onClick={() => handleQuickSelect('yesterday')} className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 transition-colors">
          <span className="text-2xl">⏮️</span>
          <div className="flex-1 text-left">
            <div className="font-medium text-gray-900 dark:text-gray-100">{t('transactions.yesterday')}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">{(() => { const y = new Date(); y.setDate(y.getDate() - 1); return y.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); })()}</div>
          </div>
        </button>
        <button type="button" onClick={() => { setTimeout(() => dateInputRef.current?.showPicker?.(), 0); }} className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 transition-colors">
          <span className="text-2xl">🗓️</span>
          <div className="flex-1 text-left">
            <div className="font-medium text-gray-900 dark:text-gray-100">{t('transactions.date')}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">{t('transactions.chooseDate')}</div>
          </div>
        </button>
        <input
          ref={dateInputRef}
          type="date"
          value={date}
          onChange={(e) => { if (e.target.value) { onDateChange(e.target.value); onClose(); } }}
          className="sr-only"
        />
        {allowRecurring && onRecurrenceChange && (
          <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions.repeat')}</div>
            <div className="grid grid-cols-4 gap-2">
              {([null, 'weekly', 'monthly', 'yearly'] as const).map((freq) => {
                const labels = { null: t('transactions.never'), weekly: t('transactions.weeklyAbbr'), monthly: t('transactions.monthlyAbbr'), yearly: t('transactions.yearlyAbbr') };
                const key = freq ?? 'null';
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onRecurrenceChange(freq)}
                    className={`py-2 rounded-lg text-sm font-medium transition-colors ${recurrence === freq ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
                  >
                    {labels[key as keyof typeof labels]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
