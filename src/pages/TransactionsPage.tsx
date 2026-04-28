import { useState, useMemo } from 'react';
import { apiService } from '../services/api';
import { buildRecurringRuleDraftFromTransactionForm } from '../services/recurring';
import { useData } from '../contexts/DataContext';
import Layout from '../components/layout/Layout';
import Modal from '../components/common/Modal';
import TransactionForm from '../components/transactions/TransactionForm';
import { SkeletonTransactionRow } from '../components/common/SkeletonLoader';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import PeriodSelector from '../components/common/PeriodSelector';
import DateRangePicker from '../components/common/DateRangePicker';
import { usePeriod } from '../hooks/usePeriod';
import type { Transaction, Transfer, TransactionFormData, Order } from '../types';
import InvestmentOrderForm, { type InvestmentOrderInput } from '../components/investments/InvestmentOrderForm';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../contexts/SettingsContext';

type PeriodType = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';

type ListItem =
  | { kind: 'transaction'; data: Transaction }
  | { kind: 'transfer'; data: Transfer }
  | { kind: 'free_order'; data: Order };

type DayGroup = {
  date: string;
  items: ListItem[];
  income: number;
  expense: number;
};

export default function TransactionsPage() {
  const { t } = useTranslation();
  const { formatCurrency } = useSettings();
  const {
    transactions: allTransactions,
    transfers: allTransfers,
    freeOrders,
    accounts,
    categories,
    portfolios,
    isLoading: dataLoading,
    addTransaction,
    updateTransaction: updateTransactionCache,
    deleteTransaction: deleteTransactionCache,
    addTransfer,
    updateTransfer: updateTransferCache,
    deleteTransfer: deleteTransferCache,
    addFreeOrder,
    updateFreeOrder,
    deleteFreeOrder,
    refreshTransactions,
    refreshPortfolios,
  } = useData();

  const totalCount = allTransactions.length + allTransfers.length;
  const skeletonCount = useSkeletonCount('transactions', totalCount, dataLoading, 5);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  const [selectedFreeOrder, setSelectedFreeOrder] = useState<Order | null>(null);
  const [isFreeOrderModalOpen, setIsFreeOrderModalOpen] = useState(false);
  const [isFreeOrderDeleteOpen, setIsFreeOrderDeleteOpen] = useState(false);

  const { startDate, endDate, setPeriod } = usePeriod();

  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterAccountIds, setFilterAccountIds] = useState<Set<number>>(new Set());
  const [filterCategories, setFilterCategories] = useState<Set<string>>(new Set());



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

    const foItems: ListItem[] = freeOrders
      .filter(o => {
        const d = new Date(o.date);
        return d >= startDate && d <= endDate;
      })
      .map(o => ({ kind: 'free_order', data: o }));

    return [...txItems, ...trItems, ...foItems].sort((a, b) => {
      const dateA = new Date(a.data.date).getTime();
      const dateB = new Date(b.data.date).getTime();
      if (dateB !== dateA) return dateB - dateA;
      return (b.data.created_at ? new Date(b.data.created_at).getTime() : 0)
           - (a.data.created_at ? new Date(a.data.created_at).getTime() : 0);
    });
  }, [allTransactions, allTransfers, freeOrders, startDate, endDate]);

  const filteredItems = useMemo(() => {
    return listItems.filter(item => {
      if (filterTypes.size > 0) {
        const kind =
          item.kind === 'free_order' ? 'free_order'
          : item.kind === 'transfer' ? 'transfer'
          : item.data.type;
        if (!filterTypes.has(kind)) return false;
      }
      if (filterAccountIds.size > 0) {
        if (item.kind === 'transfer') {
          if (!filterAccountIds.has(item.data.from_account_id) && !filterAccountIds.has(item.data.to_account_id)) return false;
        } else if (item.kind === 'transaction') {
          if (!filterAccountIds.has(item.data.account_id)) return false;
        } else {
          return false;
        }
      }
      if (filterCategories.size > 0) {
        if (item.kind !== 'transaction') return false;
        if (!filterCategories.has(item.data.category)) return false;
      }
      return true;
    });
  }, [listItems, filterTypes, filterAccountIds, filterCategories]);

  const groupedByDay = useMemo((): DayGroup[] => {
    const map = new Map<string, DayGroup>();
    for (const item of filteredItems) {
      const date = item.data.date.slice(0, 10);
      if (!map.has(date)) map.set(date, { date, items: [], income: 0, expense: 0 });
      const g = map.get(date)!;
      g.items.push(item);
      if (item.kind === 'transaction') {
        if (item.data.type === 'income') g.income += Math.abs(item.data.amount);
        else if (item.data.type === 'expense') g.expense += Math.abs(item.data.amount);
      }
    }
    return Array.from(map.values());
  }, [filteredItems]);

  const getAccountName = (accountId: number) => {
    if (!accountId) return '';
    const account = accounts.find((a) => a.id === accountId);
    return account ? `${account.icon} ${account.name}` : `Conto #${accountId}`;
  };

  const getCategoryIcon = (categoryName: string, type?: string) => {
    if (type === 'investment') {
      const portfolio = portfolios.find((p) => p.name === categoryName);
      if (portfolio?.icon) return portfolio.icon;
    }
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
    // Quota gratuita: crea solo l'ordine, nessuna transazione su conto
    if (data.type === 'investment' && data.free_quote && data.portfolio_id && data.ticker) {
      const qty = data.quantity ?? 0;
      const price = data.price ?? 0;
      const newOrder = await apiService.createOrder({
        portfolio_id: data.portfolio_id,
        symbol: data.ticker,
        isin: data.isin,
        name: data.instrument_name,
        exchange: data.exchange,
        instrument_type: data.instrument_type,
        ter: data.ter,
        currency: 'EUR',
        quantity: qty,
        price,
        commission: 0,
        order_type: 'buy',
        date: data.date,
      });
      addFreeOrder(newOrder);
      localStorage.removeItem('pf_summaries_cache');
      return;
    }

    if (data.recurrence) {
      const rule = await apiService.createRecurringTransaction(buildRecurringRuleDraftFromTransactionForm(data));
      const newTransaction = await apiService.createTransaction({ ...data, recurring_id: rule.id });
      addTransaction(newTransaction);
      if (data.type === 'investment' && data.portfolio_id && data.ticker) {
        const qty = data.quantity ?? 0;
        const price = data.price ?? 0;
        const grossAmount = Math.abs(data.amount);
        const commission = grossAmount - qty * price;
        await apiService.createOrder({
          portfolio_id: data.portfolio_id,
          symbol: data.ticker,
          isin: data.isin,
          name: data.instrument_name,
          exchange: data.exchange,
          instrument_type: data.instrument_type,
          currency: 'EUR',
          quantity: qty,
          price,
          commission: commission > 0 ? commission : 0,
          order_type: data.order_type || 'buy',
          date: data.date,
          transaction_id: newTransaction.id,
        });
        localStorage.removeItem('pf_summaries_cache');
      }
    } else {
      const newTransaction = await apiService.createTransaction(data);
      addTransaction(newTransaction);
      // Se investimento con portafoglio e ticker, crea anche l'ordine
      if (data.type === 'investment' && data.portfolio_id && data.ticker) {
        const qty = data.quantity ?? 0;
        const price = data.price ?? 0;
        const grossAmount = Math.abs(data.amount);
        const commission = grossAmount - qty * price;
        apiService.createOrder({
          portfolio_id: data.portfolio_id,
          symbol: data.ticker,
          isin: data.isin,
          name: data.instrument_name,
          exchange: data.exchange,
          instrument_type: data.instrument_type,
          ter: data.ter,
          currency: 'EUR',
          quantity: qty,
          price: price,
          commission: commission > 0 ? commission : 0,
          order_type: data.order_type || 'buy',
          date: data.date,
          transaction_id: newTransaction.id,
        }).catch(console.error);
        localStorage.removeItem('pf_summaries_cache');
      }
    }
  };

  const handleDeleteRecurringRule = async () => {
    if (selectedTransaction?.recurring_id) {
      await apiService.deleteRecurringTransaction(selectedTransaction.recurring_id);
      await refreshTransactions();
      if (selectedTransaction.type === 'investment') {
        await refreshPortfolios();
      }
      window.dispatchEvent(new CustomEvent('trackr:refresh'));
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
      let recurringId = selectedTransaction.recurring_id;
      if (data.recurrence) {
        const recurringPayload = buildRecurringRuleDraftFromTransactionForm(data);
        if (selectedTransaction.recurring_id) {
          await apiService.updateRecurringTransaction(selectedTransaction.recurring_id, recurringPayload);
        } else {
          const rule = await apiService.createRecurringTransaction(recurringPayload);
          recurringId = rule.id;
        }
      } else if (selectedTransaction.recurring_id) {
        await apiService.deleteRecurringTransaction(selectedTransaction.recurring_id);
        recurringId = undefined;
      }

      const updated = await apiService.updateTransaction(selectedTransaction.id, { ...data, recurring_id: recurringId });
      updateTransactionCache(updated);
      // Aggiorna anche l'ordine associato se è un investimento
      if (data.type === 'investment' && data.ticker) {
        const qty = data.quantity ?? 0;
        const price = data.price ?? 0;
        const grossAmount = Math.abs(data.amount);
        const commission = grossAmount - qty * price;
        apiService.updateOrderByTransactionId(selectedTransaction.id, {
          symbol: data.ticker,
          isin: data.isin,
          name: data.instrument_name,
          exchange: data.exchange,
          instrument_type: data.instrument_type,
          ter: data.ter,
          quantity: qty,
          price: price,
          commission: commission > 0 ? commission : 0,
          order_type: data.order_type || 'buy',
          date: data.date,
        }).then(() => localStorage.removeItem('pf_summaries_cache')).catch(console.error);
      }
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
      if (selectedTransaction.recurring_id) {
        await apiService.rewindRecurringTransactionOccurrence(selectedTransaction.recurring_id, selectedTransaction.date).catch(console.error);
      }
      if (selectedTransaction.type === 'investment') {
        await apiService.deleteOrderByTransactionId(selectedTransaction.id).catch(console.error);
        localStorage.removeItem('pf_summaries_cache');
      }
      await apiService.deleteTransaction(selectedTransaction.id);
      deleteTransactionCache(selectedTransaction.id);
      await refreshTransactions();
      if (selectedTransaction.type === 'investment') {
        await refreshPortfolios();
      }
      window.dispatchEvent(new CustomEvent('trackr:refresh'));
      closeModal();
    }
  };

  const handleItemClick = (item: ListItem) => {
    if (item.kind === 'free_order') {
      setSelectedFreeOrder(item.data);
      setIsFreeOrderModalOpen(true);
      return;
    }
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

  const handleFreeOrderUpdate = async (draft: InvestmentOrderInput) => {
    if (!selectedFreeOrder) return;
    const updated = await apiService.updateOrder(selectedFreeOrder.id, {
      symbol: draft.symbol,
      isin: draft.isin,
      name: draft.name,
      exchange: draft.exchange,
      instrument_type: draft.instrumentType,
      ter: draft.ter,
      quantity: draft.quantity,
      price: draft.price,
      commission: draft.commission,
      order_type: draft.orderType,
      date: draft.date,
    });
    updateFreeOrder(updated);
    localStorage.removeItem('pf_summaries_cache');
    setIsFreeOrderModalOpen(false);
  };

  const handleFreeOrderDelete = async () => {
    if (!selectedFreeOrder) return;
    await apiService.deleteOrder(selectedFreeOrder.id);
    deleteFreeOrder(selectedFreeOrder.id);
    localStorage.removeItem('pf_summaries_cache');
    setIsFreeOrderDeleteOpen(false);
    setIsFreeOrderModalOpen(false);
  };

  const handleNewTransaction = () => {
    setSelectedTransaction(null);
    setSelectedTransfer(null);
    setIsEditMode(false);
    setIsModalOpen(true);
  };

  const formatDayHeader = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    const todayStr = new Date().toDateString();
    const yesterdayStr = new Date(Date.now() - 86400000).toDateString();
    if (date.toDateString() === todayStr) return t('transactions.today');
    if (date.toDateString() === yesterdayStr) return t('transactions.yesterday');
    return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
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
        order_type: selectedTransaction.amount < 0 ? 'sell' : 'buy',
      };
    }
    return undefined;
  }, [selectedTransaction, selectedTransfer]);

  const typeFilters = [
    { value: 'expense', label: t('transactions.expense') },
    { value: 'income', label: t('transactions.income') },
    { value: 'investment', label: t('transactions.investment') },
  ];

  const toggleSet = <T,>(prev: Set<T>, value: T): Set<T> => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

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

        {/* Filter strip */}
        <div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFilterTypes(new Set())}
              className={`flex-1 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterTypes.size === 0
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
              }`}
            >
              Tutti
            </button>
            {typeFilters.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilterTypes(prev =>
                  prev.size === 1 && prev.has(value) ? new Set() : new Set([value])
                )}
                className={`flex-1 px-2 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  filterTypes.has(value)
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setIsFilterOpen(v => !v)}
              className={`flex-shrink-0 flex items-center justify-center gap-1 w-9 h-7 rounded-full text-xs font-medium transition-colors ${
                filterAccountIds.size > 0 || filterCategories.size > 0
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V15a1 1 0 01-.553.894l-4 2A1 1 0 017 17v-6.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
              </svg>
              {filterAccountIds.size + filterCategories.size > 0 && (
                <span>{filterAccountIds.size + filterCategories.size}</span>
              )}
            </button>
          </div>

          {isFilterOpen && (
            <div className="mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-md px-4 py-3 space-y-3">
              {accounts.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('transactions.account')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {accounts.map(acc => (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => setFilterAccountIds(prev => toggleSet(prev, acc.id))}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                          filterAccountIds.has(acc.id)
                            ? 'bg-primary-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {acc.icon} {acc.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {categories.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">{t('transactions.category')}</div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {categories.map(cat => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setFilterCategories(prev => toggleSet(prev, cat.name))}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                          filterCategories.has(cat.name)
                            ? 'bg-primary-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {cat.icon} {cat.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(filterAccountIds.size > 0 || filterCategories.size > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterAccountIds(new Set());
                    setFilterCategories(new Set());
                  }}
                  className="text-xs text-primary-500 dark:text-primary-400 hover:underline"
                >
                  Rimuovi filtri
                </button>
              )}
            </div>
          )}
        </div>

        {/* Aggiungi nuova transazione */}
        <div
          className="bg-white dark:bg-gray-800 rounded-xl shadow-md px-4 py-6 md:py-3 flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-gray-700 cursor-pointer outline-none select-none"
          style={{ WebkitTapHighlightColor: 'transparent' }}
          onClick={handleNewTransaction}
        >
          <div className="w-10 h-10 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 font-bold text-2xl">+</div>
        </div>

        {/* Lista transazioni raggruppate per giorno */}
        <div className="space-y-6">
          {dataLoading
            ? Array.from({ length: skeletonCount }).map((_, i) => <SkeletonTransactionRow key={i} />)
            : groupedByDay.map((group) => (
                <div key={group.date}>
                  <div className="flex items-center gap-3 my-1">
                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                    <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 capitalize whitespace-nowrap">
                      {formatDayHeader(group.date)}
                    </span>
                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                  </div>
                  <div className="space-y-2">
                    {group.items.map((item) => {
                      if (item.kind === 'transfer') {
                        const tr = item.data;
                        return (
                          <div
                            key={`transfer-${tr.id}`}
                            className="card flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
                            onClick={() => handleItemClick(item)}
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <span className="text-2xl">🔄</span>
                              <div className="flex-1">
                                <div className="font-medium text-gray-900 dark:text-gray-100">{t('transactions.transfer')}</div>
                                {tr.description && (
                                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{tr.description}</div>
                                )}
                              </div>
                            </div>
                            <div className="text-right ml-4">
                              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                                {getAccountName(tr.from_account_id)} → {getAccountName(tr.to_account_id)}
                              </div>
                              <div className="font-bold text-lg text-gray-900 dark:text-gray-100">
                                {formatCurrency(tr.amount)}
                              </div>
                            </div>
                          </div>
                        );
                      }

                      if (item.kind === 'free_order') {
                        const order = item.data;
                        const portfolio = portfolios.find(p => p.id === order.portfolio_id);
                        return (
                          <div
                            key={`free-order-${order.id}`}
                            className="card flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
                            onClick={() => handleItemClick(item)}
                          >
                            <div className="flex items-center gap-3 flex-1">
                              <span className="text-2xl">🎁</span>
                              <div className="flex-1">
                                <div className="font-medium text-gray-900 dark:text-gray-100">
                                  {portfolio?.name || t('transactions.investment', 'Investimento')}
                                </div>
                                <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                  {order.symbol} • {order.quantity} x {formatCurrency(order.price)}
                                </div>
                              </div>
                            </div>
                            <div className="text-right ml-4">
                              <div className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">
                                {t('transactions.freeQuote', 'Quota gratuita')}
                              </div>
                              <div className="font-bold text-lg text-emerald-600 dark:text-emerald-400">
                                +{formatCurrency(order.quantity * order.price)}
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
                            <span className="text-2xl">{getCategoryIcon(transaction.category, transaction.type)}</span>
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
                              {transaction.type === 'income' ? '+' : transaction.amount < 0 ? '+' : '-'}{formatCurrency(Math.abs(transaction.amount))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
        </div>

        {/* Modal transazione */}
        <Modal
          isOpen={isModalOpen}
          onClose={closeModal}
          title={isEditMode ? t('transactions.editTransaction') : t('transactions.newTransaction')}
        >
          <TransactionForm
            onSubmit={isEditMode ? handleUpdateTransaction : handleCreateTransaction}
            onCancel={closeModal}
            initialData={editInitialData}
            isEditMode={isEditMode}
            onDelete={isEditMode ? handleDeleteTransaction : undefined}
            isRecurring={isEditMode && !!selectedTransaction?.recurring_id}
            initialRecurringId={selectedTransaction?.recurring_id}
            onDeleteRecurringRule={isEditMode && selectedTransaction?.recurring_id ? handleDeleteRecurringRule : undefined}
            initialTransactionId={selectedTransaction?.id}
          />
        </Modal>

        {/* Modale edit quota gratuita */}
        <Modal
          isOpen={isFreeOrderModalOpen}
          onClose={() => setIsFreeOrderModalOpen(false)}
          title={t('transactions.freeQuote', 'Quota gratuita')}
        >
          {selectedFreeOrder && (
            <div className="space-y-4">
              <InvestmentOrderForm
                key={`free-order-edit-${selectedFreeOrder.id}`}
                currency={selectedFreeOrder.currency ?? 'EUR'}
                showActions={true}
                existingOrders={[]}
                ignoreOrderId={selectedFreeOrder.id}
                initialData={{
                  symbol: selectedFreeOrder.symbol,
                  isin: selectedFreeOrder.isin,
                  name: selectedFreeOrder.name,
                  exchange: selectedFreeOrder.exchange,
                  ter: selectedFreeOrder.ter,
                  quantity: selectedFreeOrder.quantity,
                  price: selectedFreeOrder.price,
                  commission: selectedFreeOrder.commission ?? 0,
                  date: selectedFreeOrder.date,
                  orderType: 'buy',
                  instrumentType: (selectedFreeOrder.instrument_type as 'etf' | 'stock' | 'bond') ?? 'etf',
                }}
                onSubmit={handleFreeOrderUpdate}
                onCancel={() => setIsFreeOrderModalOpen(false)}
              />
              <button
                type="button"
                onClick={() => setIsFreeOrderDeleteOpen(true)}
                className="w-full px-4 py-2.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors text-sm font-medium flex items-center justify-center gap-2"
              >
                <span>🗑️</span>
                <span>{t('common.delete')}</span>
              </button>
            </div>
          )}
        </Modal>

        <ConfirmDialog
          isOpen={isFreeOrderDeleteOpen}
          onClose={() => setIsFreeOrderDeleteOpen(false)}
          onConfirm={handleFreeOrderDelete}
          title={t('transactions.deleteTransaction')}
          message={t('transactions.deleteTransactionMsg')}
          confirmText={t('common.delete')}
          cancelText={t('common.cancel')}
          isDestructive={true}
        />

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
