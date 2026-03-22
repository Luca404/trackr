import { useState, useMemo } from 'react';
import { apiService } from '../services/api';
import { useData } from '../contexts/DataContext';
import Layout from '../components/layout/Layout';
import Modal from '../components/common/Modal';
import TransactionForm from '../components/transactions/TransactionForm';
import { SkeletonTransactionRow } from '../components/common/SkeletonLoader';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import PeriodSelector from '../components/common/PeriodSelector';
import DateRangePicker from '../components/common/DateRangePicker';
import { usePeriod } from '../hooks/usePeriod';
import type { Transaction, Transfer, TransactionFormData } from '../types';

type PeriodType = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';

type ListItem =
  | { kind: 'transaction'; data: Transaction }
  | { kind: 'transfer'; data: Transfer };

export default function TransactionsPage() {
  const {
    transactions: allTransactions,
    transfers: allTransfers,
    accounts,
    categories,
    isLoading: dataLoading,
    addTransaction,
    updateTransaction: updateTransactionCache,
    deleteTransaction: deleteTransactionCache,
    addTransfer,
    updateTransfer: updateTransferCache,
    deleteTransfer: deleteTransferCache,
  } = useData();

  const totalCount = allTransactions.length + allTransfers.length;
  const skeletonCount = useSkeletonCount('transactions', totalCount, dataLoading, 5);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const { startDate, endDate, setPeriod } = usePeriod();

  // Lista unificata filtrata per periodo, ordinata per data
  const listItems = useMemo((): ListItem[] => {
    const txItems: ListItem[] = allTransactions
      .filter(t => {
        const d = new Date(t.date);
        return d >= startDate && d <= endDate;
      })
      .map(t => ({ kind: 'transaction', data: t }));

    const trItems: ListItem[] = allTransfers
      .filter(t => {
        const d = new Date(t.date);
        return d >= startDate && d <= endDate;
      })
      .map(t => ({ kind: 'transfer', data: t }));

    return [...txItems, ...trItems].sort((a, b) => {
      const dateA = new Date(a.data.date).getTime();
      const dateB = new Date(b.data.date).getTime();
      if (dateB !== dateA) return dateB - dateA;
      return (b.data.created_at ? new Date(b.data.created_at).getTime() : 0)
           - (a.data.created_at ? new Date(a.data.created_at).getTime() : 0);
    });
  }, [allTransactions, allTransfers, startDate, endDate]);

  const getAccountName = (accountId: number) => {
    if (!accountId) return '';
    const account = accounts.find((a) => a.id === accountId);
    return account ? `${account.icon} ${account.name}` : `Conto #${accountId}`;
  };

  const getCategoryIcon = (categoryName: string) => {
    const category = categories.find((c) => c.name === categoryName);
    return category?.icon || '📌';
  };

  const handlePeriodChange = (start: Date, end: Date, type: PeriodType) => {
    setPeriod(start, end, type);
  };

  const handleCustomPeriodConfirm = (start: Date, end: Date) => {
    setPeriod(start, end, 'custom');
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedTransaction(null);
    setSelectedTransfer(null);
    setIsEditMode(false);
  };

  const handleCreateTransaction = async (data: TransactionFormData) => {
    if (data.type === 'transfer') {
      const transfer = await apiService.createTransfer(data);
      addTransfer(transfer);
      return;
    }
    if (data.recurrence) {
      const rule = await apiService.createRecurringTransaction({
        account_id: data.account_id!,
        type: data.type,
        category: data.category,
        subcategory: data.subcategory,
        amount: data.amount,
        description: data.description,
        frequency: data.recurrence,
        start_date: data.date,
      });
      const newTransaction = await apiService.createTransaction({ ...data, recurring_id: rule.id });
      addTransaction(newTransaction);
    } else {
      const newTransaction = await apiService.createTransaction(data);
      addTransaction(newTransaction);
      // Se investimento con portafoglio e ticker, crea anche l'ordine
      if (data.type === 'investment' && data.portfolio_id && data.ticker) {
        const qty = data.quantity ?? 0;
        const price = data.price ?? 0;
        const commission = data.amount - qty * price;
        apiService.createOrder({
          portfolio_id: data.portfolio_id,
          symbol: data.ticker,
          currency: 'EUR',
          quantity: qty,
          price: price,
          commission: commission > 0 ? commission : 0,
          order_type: 'buy',
          date: data.date,
          transaction_id: newTransaction.id,
        }).catch(console.error);
      }
    }
  };

  const handleDeleteRecurringRule = async () => {
    if (selectedTransaction?.recurring_id) {
      await apiService.deleteRecurringTransaction(selectedTransaction.recurring_id);
    }
    closeModal();
  };

  const handleUpdateTransaction = async (data: TransactionFormData) => {
    if (data.type === 'transfer' && selectedTransfer) {
      const updated = await apiService.updateTransfer(selectedTransfer.id, data);
      updateTransferCache(updated);
      closeModal();
      return;
    }
    if (selectedTransaction) {
      const updated = await apiService.updateTransaction(selectedTransaction.id, data);
      updateTransactionCache(updated);
      closeModal();
    }
  };

  const handleDeleteTransaction = async () => {
    if (selectedTransfer) {
      await apiService.deleteTransfer(selectedTransfer.id);
      deleteTransferCache(selectedTransfer.id);
      closeModal();
      return;
    }
    if (selectedTransaction) {
      await apiService.deleteTransaction(selectedTransaction.id);
      deleteTransactionCache(selectedTransaction.id);
      closeModal();
    }
  };

  const handleItemClick = (item: ListItem) => {
    if (item.kind === 'transfer') {
      setSelectedTransfer(item.data);
      setSelectedTransaction(null);
    } else {
      setSelectedTransaction(item.data);
      setSelectedTransfer(null);
    }
    setIsEditMode(true);
    setIsModalOpen(true);
  };

  const handleNewTransaction = () => {
    setSelectedTransaction(null);
    setSelectedTransfer(null);
    setIsEditMode(false);
    setIsModalOpen(true);
  };

  const formatCurrency = (amount: number) => {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    const [intStr, decStr] = abs.toFixed(2).split('.');
    const intFormatted = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${sign}€ ${intFormatted},${decStr}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: 'short',
    });
  };

  // initialData per il form in edit mode
  const editInitialData = useMemo((): TransactionFormData | undefined => {
    if (selectedTransfer) {
      return {
        type: 'transfer',
        category: 'Trasferimento',
        amount: selectedTransfer.amount,
        description: selectedTransfer.description || '',
        date: selectedTransfer.date,
        account_id: selectedTransfer.from_account_id,
        to_account_id: selectedTransfer.to_account_id,
      };
    }
    if (selectedTransaction) {
      return {
        type: selectedTransaction.type,
        category: selectedTransaction.category,
        subcategory: selectedTransaction.subcategory,
        amount: Math.abs(selectedTransaction.amount),
        description: selectedTransaction.description || '',
        date: selectedTransaction.date,
        account_id: selectedTransaction.account_id,
        ticker: selectedTransaction.ticker,
        quantity: selectedTransaction.quantity,
        price: selectedTransaction.price,
      };
    }
    return undefined;
  }, [selectedTransaction, selectedTransfer]);

  return (
    <Layout>
      <div className="space-y-4">
        {/* Period Selector */}
        <PeriodSelector
          startDate={startDate}
          endDate={endDate}
          onPeriodChange={handlePeriodChange}
          onCustomClick={() => setIsDatePickerOpen(true)}
        />

        {/* Aggiungi nuova transazione */}
        <div
          className="bg-white dark:bg-gray-800 rounded-xl shadow-md px-4 py-6 flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-gray-700 cursor-pointer outline-none select-none"
          style={{ WebkitTapHighlightColor: 'transparent' }}
          onClick={handleNewTransaction}
        >
          <div className="w-10 h-10 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 font-bold text-2xl">+</div>
        </div>

        {/* Lista unificata transazioni + trasferimenti */}
        <div className="space-y-2">
          {dataLoading
            ? Array.from({ length: skeletonCount }).map((_, i) => <SkeletonTransactionRow key={i} />)
            : listItems.map((item) => {
                if (item.kind === 'transfer') {
                  const t = item.data;
                  return (
                    <div
                      key={`transfer-${t.id}`}
                      className="card flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => handleItemClick(item)}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <span className="text-2xl">🔄</span>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100">Trasferimento</div>
                          {t.description && (
                            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t.description}</div>
                          )}
                        </div>
                      </div>
                      <div className="text-right ml-4">
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                          {getAccountName(t.from_account_id)} → {getAccountName(t.to_account_id)}
                        </div>
                        <div className="font-bold text-lg text-gray-900 dark:text-gray-100">
                          {formatCurrency(t.amount)}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(t.date)}
                        </div>
                      </div>
                    </div>
                  );
                }

                const transaction = item.data;
                return (
                  <div
                    key={`tx-${transaction.id}`}
                    className="card flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => handleItemClick(item)}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <span className="text-2xl">{getCategoryIcon(transaction.category)}</span>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1">
                          {transaction.category}
                          {transaction.subcategory && (
                            <span className="text-sm text-gray-500 dark:text-gray-400"> ({transaction.subcategory})</span>
                          )}
                          {transaction.recurring_id && (
                            <span className="text-xs text-primary-500 dark:text-primary-400">🔄</span>
                          )}
                        </div>
                        {transaction.description && (
                          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {transaction.description}
                          </div>
                        )}
                        {transaction.ticker && (
                          <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                            {transaction.ticker} • {transaction.quantity} x {formatCurrency(transaction.price || 0)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right ml-4">
                      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        {getAccountName(transaction.account_id)}
                      </div>
                      <div className={`font-bold text-lg ${
                        transaction.type === 'income'
                          ? 'text-green-600 dark:text-green-400'
                          : transaction.type === 'expense'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-blue-600 dark:text-blue-400'
                      }`}>
                        {transaction.type === 'income' ? '+' : '-'}{formatCurrency(Math.abs(transaction.amount))}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(transaction.date)}
                      </div>
                    </div>
                  </div>
                );
              })}

        </div>

        {/* Modal transazione */}
        <Modal
          isOpen={isModalOpen}
          onClose={closeModal}
          title={isEditMode ? "Modifica" : "Nuova Transazione"}
        >
          <TransactionForm
            onSubmit={isEditMode ? handleUpdateTransaction : handleCreateTransaction}
            onCancel={closeModal}
            initialData={editInitialData}
            isEditMode={isEditMode}
            onDelete={isEditMode ? handleDeleteTransaction : undefined}
            isRecurring={isEditMode && !!selectedTransaction?.recurring_id}
            onDeleteRecurringRule={isEditMode && selectedTransaction?.recurring_id ? handleDeleteRecurringRule : undefined}
          />
        </Modal>

        {/* Date Range Picker */}
        <DateRangePicker
          isOpen={isDatePickerOpen}
          onClose={() => setIsDatePickerOpen(false)}
          onConfirm={handleCustomPeriodConfirm}
          initialStart={startDate}
          initialEnd={endDate}
        />
      </div>
    </Layout>
  );
}
