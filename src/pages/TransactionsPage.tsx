import { useState, useMemo } from 'react';
import { apiService } from '../services/api';
import { useData } from '../contexts/DataContext';
import Layout from '../components/layout/Layout';
import Modal from '../components/common/Modal';
import TransactionForm from '../components/transactions/TransactionForm';
import SkeletonLoader from '../components/common/SkeletonLoader';
import PeriodSelector from '../components/common/PeriodSelector';
import DateRangePicker from '../components/common/DateRangePicker';
import { usePeriod } from '../hooks/usePeriod';
import type { Transaction, TransactionFormData } from '../types';

type PeriodType = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';

export default function TransactionsPage() {
  const { transactions: allTransactions, accounts, categories, isLoading: dataLoading, addTransaction, updateTransaction: updateTransactionCache, deleteTransaction: deleteTransactionCache } = useData();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  // Period state - condiviso tra le pagine
  const { startDate, endDate, setPeriod } = usePeriod();

  // Filtra le transazioni in base al periodo selezionato
  const transactions = useMemo(() => {
    return allTransactions.filter(transaction => {
      const transactionDate = new Date(transaction.date);
      return transactionDate >= startDate && transactionDate <= endDate;
    });
  }, [allTransactions, startDate, endDate]);

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

  const handleCreateTransaction = async (data: TransactionFormData) => {
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
    }
  };

  const handleDeleteRecurringRule = async () => {
    if (selectedTransaction?.recurring_id) {
      await apiService.deleteRecurringTransaction(selectedTransaction.recurring_id);
    }
    setIsModalOpen(false);
    setSelectedTransaction(null);
    setIsEditMode(false);
  };

  const handleUpdateTransaction = async (data: TransactionFormData) => {
    if (selectedTransaction) {
      const updated = await apiService.updateTransaction(selectedTransaction.id, data);
      updateTransactionCache(updated);
      setIsModalOpen(false);
      setSelectedTransaction(null);
      setIsEditMode(false);
    }
  };

  const handleDeleteTransaction = async () => {
    if (selectedTransaction) {
      await apiService.deleteTransaction(selectedTransaction.id);
      deleteTransactionCache(selectedTransaction.id);
      setIsModalOpen(false);
      setSelectedTransaction(null);
      setIsEditMode(false);
    }
  };

  const handleTransactionClick = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setIsEditMode(true);
    setIsModalOpen(true);
  };

  const handleNewTransaction = () => {
    setSelectedTransaction(null);
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

  if (dataLoading) {
    return <Layout><SkeletonLoader /></Layout>;
  }

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

        {/* Lista transazioni */}
        <div className="space-y-2">
          {transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="card flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleTransactionClick(transaction)}
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
                        : transaction.type === 'investment'
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-purple-600 dark:text-purple-400'
                    }`}>
                      {transaction.type === 'income' ? '+' : '-'}{formatCurrency(Math.abs(transaction.amount))}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(transaction.date)}
                    </div>
                  </div>
                </div>
          ))}
          {/* Aggiungi nuova transazione */}
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-md px-4 py-6 flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-gray-700 cursor-pointer outline-none select-none"
            style={{ WebkitTapHighlightColor: 'transparent' }}
            onClick={handleNewTransaction}
          >
            <div className="w-10 h-10 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 font-bold text-2xl">+</div>
          </div>
        </div>

        {/* Modal transazione */}
        <Modal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedTransaction(null);
            setIsEditMode(false);
          }}
          title={isEditMode ? "Modifica Transazione" : "Nuova Transazione"}
        >
          <TransactionForm
            onSubmit={isEditMode ? handleUpdateTransaction : handleCreateTransaction}
            onCancel={() => {
              setIsModalOpen(false);
              setSelectedTransaction(null);
              setIsEditMode(false);
            }}
            initialData={selectedTransaction ? {
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
            } : undefined}
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
