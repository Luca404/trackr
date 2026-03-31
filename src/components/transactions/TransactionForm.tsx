import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';
import type { TransactionFormData, TransactionType, Category, Subcategory, Account, Portfolio, RecurringFrequency, Order } from '../../types';
import { useData } from '../../contexts/DataContext';
import { apiService } from '../../services/api';
import ConfirmDialog from '../common/ConfirmDialog';
import Modal, { registerBackHandler } from '../common/Modal';
import TransactionDateModal from '../common/TransactionDateModal';
import InvestmentOrderForm, { type InvestmentOrderInput } from '../investments/InvestmentOrderForm';

interface TransactionFormProps {
  onSubmit: (data: TransactionFormData) => Promise<void>;
  onCancel: () => void;
  initialData?: TransactionFormData;
  isEditMode?: boolean;
  onDelete?: () => Promise<void>;
  isRecurring?: boolean;
  initialRecurringId?: number;
  onDeleteRecurringRule?: () => Promise<void>;
  initialTransactionId?: number;
}

export default function TransactionForm({ onSubmit, onCancel, initialData, isEditMode, onDelete, isRecurring, initialRecurringId, onDeleteRecurringRule, initialTransactionId }: TransactionFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatCurrency, numberFormat } = useSettings();
  const { categories: allCategories, accounts: allAccounts, portfolios: allPortfolios } = useData();
  const [currentType, setCurrentType] = useState<TransactionType>(initialData?.type || 'expense');

  const categories = useMemo(() => {
    if (currentType === 'transfer') return [];
    return allCategories.filter(c => c.category_type === currentType);
  }, [allCategories, currentType]);

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<Subcategory | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedToAccount, setSelectedToAccount] = useState<Account | null>(null);
  const [showToAccountPicker, setShowToAccountPicker] = useState(false);
  const [amount, setAmount] = useState<string>(initialData?.amount.toString() || '');
  const [date, setDate] = useState<string>(initialData?.date || new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState<string>(initialData?.description || '');
  const [showDateSelector, setShowDateSelector] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [showPortfolioPicker, setShowPortfolioPicker] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [currency, setCurrency] = useState<string>('EUR');
  const [investmentDraft, setInvestmentDraft] = useState<InvestmentOrderInput>({
    symbol: initialData?.ticker || '',
    isin: initialData?.isin,
    name: initialData?.instrument_name,
    exchange: initialData?.exchange,
    ter: initialData?.ter,
    quantity: initialData?.quantity || 0,
    price: initialData?.price || 0,
    commission: initialData?.quantity && initialData?.price ? Math.max(0, initialData.amount - (initialData.quantity * initialData.price)) : 0,
    date: initialData?.date || new Date().toISOString().split('T')[0],
    orderType: initialData?.order_type || 'buy',
    instrumentType: initialData?.instrument_type || 'etf',
  });
  const [isInvestmentDraftValid, setIsInvestmentDraftValid] = useState(false);

  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [investmentOrders, setInvestmentOrders] = useState<Order[]>([]);
  const [linkedOrder, setLinkedOrder] = useState<Order | null>(null);

  const [recurrence, setRecurrence] = useState<RecurringFrequency | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [showRecurringDeleteModal, setShowRecurringDeleteModal] = useState(false);

  // Back gesture quando la categoria è selezionata → torna alla griglia (solo nuova transazione)
  useEffect(() => {
    if (!selectedCategory || isEditMode) return;
    return registerBackHandler(() => setSelectedCategory(null));
  }, [selectedCategory, isEditMode]);

  // Back gesture quando il portafoglio è selezionato in investment (solo nuova transazione)
  useEffect(() => {
    if (!selectedPortfolio || isEditMode || currentType !== 'investment') return;
    return registerBackHandler(() => setSelectedPortfolio(null));
  }, [selectedPortfolio, isEditMode, currentType]);

  // Account preferito di default
  useEffect(() => {
    if (!selectedAccount && allAccounts.length > 0) {
      const favoriteAccount = allAccounts.find(acc => acc.is_favorite);
      setSelectedAccount(favoriteAccount || allAccounts[0]);
    }
  }, [allAccounts, selectedAccount]);

  // Reset categoria/portafoglio quando cambia tipo
  useEffect(() => {
    setSelectedCategory(null);
    setSelectedSubcategory(null);
    if (currentType !== 'investment') setSelectedPortfolio(null);
    // Per il trasferimento: auto-seleziona il primo conto diverso da quello di origine
    if (currentType === 'transfer' && !selectedToAccount && allAccounts.length >= 2) {
      const other = allAccounts.find(a => a.id !== selectedAccount?.id);
      if (other) setSelectedToAccount(other);
    }
  }, [currentType]);

  // Pre-fill categoria in edit mode
  useEffect(() => {
    if (isEditMode && initialData && categories.length > 0) {
      const category = categories.find(c => c.name === initialData.category);
      if (category) {
        setSelectedCategory(category);
        if (initialData.subcategory) {
          const subcategory = category.subcategories?.find(s => s.name === initialData.subcategory);
          if (subcategory) setSelectedSubcategory(subcategory);
        }
      }
    }
  }, [isEditMode, initialData, categories]);

  // Pre-fill conto in edit mode
  useEffect(() => {
    if (isEditMode && initialData?.account_id && allAccounts.length > 0) {
      const account = allAccounts.find(acc => acc.id === initialData.account_id);
      if (account) setSelectedAccount(account);
    }
  }, [isEditMode, initialData, allAccounts]);

  // Pre-fill conto destinazione in edit mode (transfer)
  useEffect(() => {
    if (isEditMode && initialData?.to_account_id && allAccounts.length > 0) {
      const account = allAccounts.find(acc => acc.id === initialData.to_account_id);
      if (account) setSelectedToAccount(account);
    }
  }, [isEditMode, initialData, allAccounts]);

  // In edit mode, pre-seleziona il portafoglio dalla transazione esistente
  useEffect(() => {
    if (!isEditMode || currentType !== 'investment' || allPortfolios.length === 0) return;
    if (initialData?.portfolio_id) {
      const p = allPortfolios.find(p => p.id === initialData.portfolio_id);
      if (p) setSelectedPortfolio(p);
    } else if (initialData?.category) {
      const p = allPortfolios.find(p => p.name === initialData.category);
      if (p) setSelectedPortfolio(p);
    } else {
      setSelectedPortfolio(allPortfolios[0] ?? null);
    }
  }, [isEditMode, currentType, allPortfolios, initialData?.portfolio_id, initialData?.category]);

  useEffect(() => {
    if (currentType !== 'investment' || !selectedPortfolio) {
      setInvestmentOrders([]);
      return;
    }
    let cancelled = false;
    apiService.getOrders(selectedPortfolio.id)
      .then((orders) => {
        if (!cancelled) setInvestmentOrders(orders);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Error loading investment orders:', error);
          setInvestmentOrders([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentType, selectedPortfolio?.id]);

  useEffect(() => {
    if (currentType !== 'investment') return;
    setInvestmentDraft({
      symbol: initialData?.ticker || '',
      isin: initialData?.isin,
      name: initialData?.instrument_name,
      exchange: initialData?.exchange,
      ter: initialData?.ter,
      quantity: initialData?.quantity || 0,
      price: initialData?.price || 0,
      commission: initialData?.quantity && initialData?.price ? Math.max(0, initialData.amount - (initialData.quantity * initialData.price)) : 0,
      date: initialData?.date || new Date().toISOString().split('T')[0],
      orderType: initialData?.order_type || 'buy',
      instrumentType: initialData?.instrument_type || 'etf',
    });
  }, [currentType, initialData]);

  useEffect(() => {
    if (currentType !== 'investment' || !initialTransactionId) {
      setLinkedOrder(null);
      return;
    }
    let cancelled = false;
    apiService.getOrderByTransactionId(initialTransactionId)
      .then((order) => {
        if (!cancelled) setLinkedOrder(order);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Error loading linked order:', error);
          setLinkedOrder(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentType, initialTransactionId]);

  useEffect(() => {
    if (!initialRecurringId) {
      setRecurrence(null);
      return;
    }
    let cancelled = false;
    apiService.getRecurringTransaction(initialRecurringId)
      .then((rule) => {
        if (!cancelled) setRecurrence(rule?.frequency ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Error loading recurring rule:', error);
          setRecurrence(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialRecurringId]);

  const handleNumberClick = (num: string) => {
    if (num === '.' && amount.includes('.')) return;
    setAmount(prev => prev === '0' ? num : prev + num);
  };

  const handleBackspace = () => {
    setAmount(prev => prev.length > 1 ? prev.slice(0, -1) : '0');
  };

  const formatAmountDisplay = (value: string): string => {
    const negative = value.startsWith('-');
    const abs = negative ? value.slice(1) : value;
    const [intStr, decStr] = abs.split('.');
    const thousandsSep = numberFormat === 'dot' ? ',' : '.';
    const decimalSep = numberFormat === 'dot' ? '.' : ',';
    const intFormatted = (parseInt(intStr) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep);
    const result = decStr !== undefined ? `${intFormatted}${decimalSep}${decStr}` : intFormatted;
    return negative ? `-${result}` : result;
  };

  const getCurrencySymbol = (curr: string) => {
    const symbols: Record<string, string> = { 'EUR': '€', 'USD': '$', 'GBP': '£', 'JPY': '¥', 'CHF': 'Fr' };
    return symbols[curr] || curr;
  };

  const handleDeleteConfirm = async () => {
    if (!onDelete) return;
    setIsLoading(true);
    try {
      await onDelete();
    } catch (err: any) {
      setError(err.response?.data?.message || t('transactions.errorDeleting'));
      setIsLoading(false);
    }
  };

  const handleDeleteRuleConfirm = async () => {
    if (!onDeleteRecurringRule) return;
    setIsLoading(true);
    try {
      await onDeleteRecurringRule();
    } catch (err: any) {
      setError(t('transactions.errorDeletingRule'));
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!selectedAccount) return;

    let submitData: TransactionFormData;

    if (currentType === 'transfer') {
      if (!selectedToAccount) return;
      if (selectedToAccount.id === selectedAccount.id) return;
      const amountNum = parseFloat(amount) || 0;
      if (amountNum <= 0) return;
      submitData = {
        type: 'transfer',
        category: 'Trasferimento',
        amount: amountNum,
        description,
        date,
        account_id: selectedAccount.id,
        to_account_id: selectedToAccount.id,
      };
      setError('');
      setIsLoading(true);
      try {
        await onSubmit(submitData);
        onCancel();
      } catch (err: any) {
        setError(err.response?.data?.message || t('transactions.errorSaving'));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (currentType === 'investment') {
      const { quantity, price, commission, symbol, isin, name, exchange, instrumentType, orderType, ter, date: investmentDate } = investmentDraft;
      const grossAmount = quantity * price + commission;
      const total = orderType === 'sell' ? -grossAmount : grossAmount;
      if (!isInvestmentDraftValid || grossAmount <= 0) return;
      submitData = {
        type: currentType,
        category: selectedPortfolio?.name || t('transactions.investment', 'Investment'),
        amount: total,
        description,
        date: investmentDate,
        account_id: selectedAccount.id,
        ticker: symbol || undefined,
        quantity: quantity || undefined,
        price: price || undefined,
        portfolio_id: selectedPortfolio?.id,
        isin: isin || undefined,
        instrument_name: name || undefined,
        exchange: exchange || undefined,
        instrument_type: instrumentType,
        order_type: orderType,
        ter: ter || undefined,
        recurrence: recurrence ?? undefined,
      };
    } else {
      if (!selectedCategory) return;
      const amountNum = parseFloat(amount) || 0;
      if (amountNum <= 0) return;
      submitData = {
        type: currentType,
        category: selectedCategory.name,
        subcategory: selectedSubcategory?.name,
        amount: amountNum,
        description,
        date,
        account_id: selectedAccount.id,
        recurrence: recurrence ?? undefined,
      };
    }

    setError('');
    setIsLoading(true);
    try {
      await onSubmit(submitData);
      onCancel();
    } catch (err: any) {
      setError(err.response?.data?.message || t('transactions.errorSaving'));
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  const typeButtons = [
    { type: 'expense' as TransactionType, label: t('transactions.expense'), icon: '💸', color: 'red' },
    { type: 'income' as TransactionType, label: t('transactions.income'), icon: '💰', color: 'green' },
    { type: 'investment' as TransactionType, label: t('transactions.investment'), icon: '📈', color: 'blue' },
    { type: 'transfer' as TransactionType, label: t('transactions.transfer'), icon: '🔄', color: 'purple' },
  ];

  const tabSelector = (
    <div className="flex border-b border-gray-200 dark:border-gray-700">
      {typeButtons.map(({ type, label, icon }) => (
        <button
          key={type}
          type="button"
          onClick={() => setCurrentType(type)}
          className={`flex-1 min-w-0 py-2 font-medium text-xs transition-colors flex flex-col items-center ${
            currentType === type
              ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400'
              : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          <span className="text-xl mb-0.5 leading-none">{icon}</span>
          <span className="truncate w-full text-center leading-tight">{label}</span>
        </button>
      ))}
    </div>
  );

  // Swipe sulla griglia categorie per cambiare tab
  const swipeCategoryRef = useRef<{ x: number; y: number } | null>(null);
  const handleCategorySwipeStart = (e: React.TouchEvent) => {
    swipeCategoryRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const handleCategorySwipeEnd = (e: React.TouchEvent) => {
    if (!swipeCategoryRef.current) return;
    const deltaX = e.changedTouches[0].clientX - swipeCategoryRef.current.x;
    const deltaY = e.changedTouches[0].clientY - swipeCategoryRef.current.y;
    swipeCategoryRef.current = null;
    if (Math.abs(deltaX) < 60 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;
    const idx = typeButtons.findIndex(b => b.type === currentType);
    if (deltaX < 0 && idx < typeButtons.length - 1) setCurrentType(typeButtons[idx + 1].type);
    else if (deltaX > 0 && idx > 0) setCurrentType(typeButtons[idx - 1].type);
  };

  const sharedModals = (
    <>
      {/* Modal cambio categoria */}
      <Modal isOpen={showCategoryPicker} onClose={() => setShowCategoryPicker(false)} title={t('transactions.changeCategory')}>
        <div className="grid grid-cols-3 gap-3">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => { setSelectedCategory(category); setSelectedSubcategory(null); setShowCategoryPicker(false); }}
              className="flex flex-col items-center p-3 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 transition-colors"
            >
              <span className="text-3xl mb-1">{category.icon}</span>
              <span className="text-xs text-center">{category.name}</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Modal selezione portafoglio */}
      <Modal isOpen={showPortfolioPicker} onClose={() => setShowPortfolioPicker(false)} title={t('transactions.portfolio', 'Portafoglio')}>
        <div className="space-y-2">
          {allPortfolios.map((portfolio) => (
            <button
              key={portfolio.id}
              type="button"
              onClick={() => { setSelectedPortfolio(portfolio); setShowPortfolioPicker(false); }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors ${
                selectedPortfolio?.id === portfolio.id
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-primary-500'
              }`}
            >
              <span className="text-2xl">📈</span>
              <span className="font-medium">{portfolio.name}</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Modal cambio conto */}
      <Modal isOpen={showAccountPicker} onClose={() => setShowAccountPicker(false)} title={t('transactions.selectAccount')}>
        <div className="space-y-2">
          {allAccounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => { setSelectedAccount(account); setShowAccountPicker(false); }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors ${
                selectedAccount?.id === account.id
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-primary-500'
              }`}
            >
              <span className="text-2xl">{account.icon}</span>
              <span className="font-medium">{account.name}</span>
            </button>
          ))}
        </div>
      </Modal>

      {/* Modal conto destinazione (trasferimento) */}
      <Modal isOpen={showToAccountPicker} onClose={() => setShowToAccountPicker(false)} title={t('transactions.toAccount')}>
        <div className="space-y-2">
          {allAccounts.filter(a => a.id !== selectedAccount?.id).map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => { setSelectedToAccount(account); setShowToAccountPicker(false); }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors ${
                selectedToAccount?.id === account.id
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-primary-500'
              }`}
            >
              <span className="text-2xl">{account.icon}</span>
              <span className="font-medium">{account.name}</span>
            </button>
          ))}
        </div>
      </Modal>

      <TransactionDateModal
        isOpen={showDateSelector}
        onClose={() => setShowDateSelector(false)}
        date={date}
        onDateChange={setDate}
        allowRecurring={currentType !== 'transfer'}
        recurrence={recurrence}
        onRecurrenceChange={setRecurrence}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteConfirm}
        title={t('transactions.deleteTransaction')}
        message={t('transactions.deleteTransactionMsg')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        isDestructive={true}
      />

      {/* Modal eliminazione ricorrente */}
      <Modal isOpen={showRecurringDeleteModal} onClose={() => setShowRecurringDeleteModal(false)} title={t('transactions.deleteRecurring')}>
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('transactions.deleteWhat')}</p>
          <button type="button" onClick={async () => { setShowRecurringDeleteModal(false); await handleDeleteConfirm(); }}
            className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left" disabled={isLoading}>
            <span className="text-2xl">🗑️</span>
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{t('transactions.deleteOnlyThis')}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">{t('transactions.deleteOnlyThisDesc')}</div>
            </div>
          </button>
          <button type="button" onClick={async () => { setShowRecurringDeleteModal(false); await handleDeleteRuleConfirm(); }}
            className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-orange-200 dark:border-orange-800 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors text-left" disabled={isLoading}>
            <span className="text-2xl">🔄</span>
            <div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{t('transactions.deleteRule')}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">{t('transactions.deleteRuleDesc')}</div>
            </div>
          </button>
        </div>
      </Modal>
    </>
  );

  // ── Griglia selezione portafoglio (investment, nuova transazione) ─────────
  if (currentType === 'investment' && !selectedPortfolio) {
    return (
      <div onTouchStart={handleCategorySwipeStart} onTouchEnd={handleCategorySwipeEnd} className="space-y-4">
        {tabSelector}
        <div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('transactions.selectPortfolio', 'Seleziona portafoglio')}</div>
          {allPortfolios.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <span className="text-5xl">📭</span>
              <div className="text-gray-600 dark:text-gray-400 text-sm">{t('transactions.noPortfolioWarning', 'Nessun portafoglio creato.')}</div>
              <button type="button" onClick={() => { onCancel(); navigate('/portfolios'); }}
                className="px-4 py-2 bg-primary-500 text-white rounded-lg font-medium text-sm">
                {t('transactions.createPortfolio', 'Crea portafoglio')}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
              {allPortfolios.map((portfolio) => (
                <button
                  key={portfolio.id}
                  type="button"
                  onClick={() => setSelectedPortfolio(portfolio)}
                  className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors bg-white dark:bg-gray-800"
                >
                  <span className="text-4xl mb-2">{portfolio.icon ?? '📈'}</span>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center">{portfolio.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Form investimento ────────────────────────────────────────────────────
  if (currentType === 'investment') {
    const inputClass = "w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-base";
    const noFill = { autoComplete: "off", autoCorrect: "off", spellCheck: false } as const;
    const grossAmount = investmentDraft.quantity * investmentDraft.price + investmentDraft.commission;
    const isInvestmentFormValid = Boolean(
      selectedAccount &&
      selectedPortfolio &&
      isInvestmentDraftValid &&
      grossAmount > 0
    );

    const investmentInitialData: InvestmentOrderInput = {
      symbol: linkedOrder?.symbol || initialData?.ticker || '',
      isin: linkedOrder?.isin || initialData?.isin,
      name: linkedOrder?.name || initialData?.instrument_name,
      exchange: linkedOrder?.exchange || initialData?.exchange,
      ter: linkedOrder?.ter ?? initialData?.ter,
      quantity: initialData?.quantity || 0,
      price: initialData?.price || 0,
      commission: linkedOrder?.commission ?? (initialData?.quantity && initialData?.price ? Math.max(0, Math.abs(initialData.amount) - (initialData.quantity * initialData.price)) : 0),
      date: initialData?.date || new Date().toISOString().split('T')[0],
      orderType: (linkedOrder?.order_type as 'buy' | 'sell' | undefined) || initialData?.order_type || 'buy',
      instrumentType: (linkedOrder?.instrument_type as 'etf' | 'stock' | 'bond' | undefined) || initialData?.instrument_type || 'etf',
    };

    return (
      <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
        {/* Portafoglio + Conto */}
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowPortfolioPicker(true)}
            className="flex-1 flex items-center gap-2 p-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-primary-500 transition-colors">
            <span className="text-2xl">📈</span>
            <div className="flex-1 text-left">
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('transactions.portfolio', 'Portafoglio')}</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{selectedPortfolio?.name}</div>
            </div>
            <span className="text-gray-400">›</span>
          </button>
          <button type="button" onClick={() => setShowAccountPicker(true)}
            className="flex-1 flex items-center gap-2 p-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-primary-500 transition-colors">
            <span className="text-2xl">{selectedAccount?.icon || '💳'}</span>
            <div className="flex-1 text-left">
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('transactions.account')}</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{selectedAccount?.name || t('transactions.select')}</div>
            </div>
            <span className="text-gray-400">›</span>
          </button>
        </div>

        <InvestmentOrderForm
          key={`investment-${initialTransactionId ?? 'new'}-${linkedOrder?.id ?? 'none'}`}
          currency="EUR"
          showActions={false}
          existingOrders={investmentOrders}
          ignoreTransactionId={initialTransactionId}
          allowRecurring={true}
          recurrence={recurrence}
          onRecurrenceChange={setRecurrence}
          initialData={investmentInitialData}
          onChange={(draft, meta) => {
            setInvestmentDraft(draft);
            setIsInvestmentDraftValid(meta.isValid);
          }}
          onSubmit={async () => {}}
          onCancel={() => {}}
        />

        {/* Descrizione */}
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('transactions.description')}
          className={inputClass}
          {...noFill}
        />

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || !isInvestmentFormValid}
          className="w-full px-4 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm text-white font-medium transition-colors"
        >
          {isLoading ? t('transactions.saving') : isEditMode ? t('common.save') : t('transactions.addInvestment')}
        </button>

        {isEditMode && onDelete && (
          <button
            type="button"
            onClick={() => isRecurring ? setShowRecurringDeleteModal(true) : setIsDeleteDialogOpen(true)}
            className="w-full px-4 py-2.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors text-sm font-medium flex items-center justify-center gap-2"
            disabled={isLoading}
          >
            <span className="text-base leading-none">🗑️</span>
            <span>{t('common.delete')}</span>
          </button>
        )}

        {sharedModals}
      </form>
    );
  }

  // ── Form trasferimento ────────────────────────────────────────────────────
  if (currentType === 'transfer') {
    const amountNum = parseFloat(amount);
    const isTransferFormValid = Boolean(
      selectedAccount &&
      selectedToAccount &&
      selectedToAccount.id !== selectedAccount.id &&
      amountNum > 0
    );
    return (
      <form onSubmit={handleSubmit} noValidate autoComplete="off" className="space-y-4">
        {tabSelector}

        {/* Da → A */}
        <div className="flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => setShowAccountPicker(true)}
            className="flex-1 flex items-center gap-2 p-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-primary-500 transition-colors"
          >
            <span className="text-2xl">{selectedAccount?.icon || '💳'}</span>
            <div className="flex-1 text-left">
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('transactions.from')}</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{selectedAccount?.name || t('transactions.select')}</div>
              {selectedAccount?.current_balance !== undefined && (
                <div className="text-xs text-gray-400 dark:text-gray-500">{formatCurrency(selectedAccount.current_balance)}</div>
              )}
            </div>
            <span className="text-gray-400">›</span>
          </button>

          <div className="flex items-center px-1 text-2xl text-gray-400 select-none">→</div>

          <button
            type="button"
            onClick={() => setShowToAccountPicker(true)}
            className="flex-1 flex items-center gap-2 p-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-primary-500 transition-colors"
          >
            <span className="text-2xl">{selectedToAccount?.icon || '💳'}</span>
            <div className="flex-1 text-left">
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('transactions.to')}</div>
              <div className={`font-medium ${selectedToAccount ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>
                {selectedToAccount?.name || t('transactions.select')}
              </div>
              {selectedToAccount?.current_balance !== undefined && (
                <div className="text-xs text-gray-400 dark:text-gray-500">{formatCurrency(selectedToAccount.current_balance)}</div>
              )}
            </div>
            <span className="text-gray-400">›</span>
          </button>
        </div>

        {/* Display importo */}
        <div className="text-center py-4">
          <div className="text-5xl font-bold text-gray-900 dark:text-gray-100">
            {getCurrencySymbol(currency)} {formatAmountDisplay(amount || '0')}
          </div>
        </div>

        {/* Tastierino */}
        <div className="flex gap-2">
          <div className="flex-1 grid grid-cols-3 gap-2">
            {['1','2','3','4','5','6','7','8','9'].map(n => (
              <button key={n} type="button" onClick={() => handleNumberClick(n)}
                className="h-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors">{n}</button>
            ))}
            <button type="button" onClick={() => setShowCurrencyPicker(true)}
              className="h-14 text-lg font-semibold rounded-lg bg-primary-100 dark:bg-primary-900/30 hover:bg-primary-200 dark:hover:bg-primary-900/50 text-primary-600 dark:text-primary-400 transition-colors">{getCurrencySymbol(currency)}</button>
            <button type="button" onClick={() => handleNumberClick('0')}
              className="h-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors">0</button>
            <button type="button" onClick={() => handleNumberClick('.')}
              className="h-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors">,</button>
          </div>
          <div className="flex flex-col gap-2">
          <button type="button" onClick={handleBackspace}
              className="h-14 w-14 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5 5-5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H7" />
              </svg>
            </button>
            <button type="submit" disabled={isLoading || !isTransferFormValid}
              className="flex-1 w-14 rounded-lg bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold text-3xl transition-colors flex items-center justify-center">
              {isLoading ? '...' : '✓'}
            </button>
            <button type="button" onClick={() => setShowDateSelector(true)}
              className="h-14 w-14 text-2xl rounded-lg bg-primary-100 dark:bg-primary-900/30 hover:bg-primary-200 dark:hover:bg-primary-900/50 text-primary-600 dark:text-primary-400 transition-colors">📅</button>
          </div>
        </div>

        {/* Data */}
        <div className="text-center text-sm text-gray-600 dark:text-gray-400">
          {formatDate(date)}
        </div>

        {/* Descrizione */}
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={t('transactions.description')}
          autoComplete="off" autoCorrect="off" spellCheck={false}
          className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm" />

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        {isEditMode && onDelete && (
          <button
            type="button"
            onClick={() => setIsDeleteDialogOpen(true)}
            className="w-full px-4 py-2.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors text-sm font-medium flex items-center justify-center gap-2"
            disabled={isLoading}
          >
            <span className="text-base leading-none">🗑️</span>
            <span>{t('common.delete')}</span>
          </button>
        )}

        {sharedModals}
      </form>
    );
  }

  // ── Griglia selezione categoria (tutti i tipi) ────────────────────────────
  if (!selectedCategory) {
    return (
      <div onTouchStart={handleCategorySwipeStart} onTouchEnd={handleCategorySwipeEnd} className="space-y-4">
        {tabSelector}
        <div>
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('transactions.selectCategory')}</div>
          <div className="grid grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setSelectedCategory(category)}
                className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors bg-white dark:bg-gray-800"
              >
                <span className="text-4xl mb-2">{category.icon}</span>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center">{category.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Form con tastierino numerico (expense / income / transfer) ─────────────
  const amountNum = parseFloat(amount);
  const isStandardFormValid = Boolean(selectedCategory && selectedAccount && amountNum > 0);
  return (
    <form onSubmit={handleSubmit} noValidate autoComplete="off" className="space-y-4">
      {/* Categoria e Conto */}
      <div className="flex gap-2">
        <button type="button" onClick={() => setShowCategoryPicker(true)}
          className="flex-1 flex items-center gap-2 p-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-primary-500 transition-colors">
          <span className="text-2xl">{selectedCategory.icon}</span>
          <div className="flex-1 text-left">
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('transactions.category')}</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{selectedCategory.name}</div>
          </div>
          <span className="text-gray-400">›</span>
        </button>
        <button type="button" onClick={() => setShowAccountPicker(true)}
          className="flex-1 flex items-center gap-2 p-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-primary-500 transition-colors">
          <span className="text-2xl">{selectedAccount?.icon || '💳'}</span>
          <div className="flex-1 text-left">
            <div className="text-xs text-gray-500 dark:text-gray-400">{t('transactions.account')}</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{selectedAccount?.name || t('transactions.select')}</div>
          </div>
          <span className="text-gray-400">›</span>
        </button>
      </div>

      {/* Sottocategorie */}
      {selectedCategory.subcategories && selectedCategory.subcategories.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {selectedCategory.subcategories.map((sub) => (
            <button key={sub.id} type="button"
              onClick={() => setSelectedSubcategory(selectedSubcategory?.id === sub.id ? null : sub)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${selectedSubcategory?.id === sub.id ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* Display importo */}
      <div className="text-center py-4">
        <div className="text-5xl font-bold text-gray-900 dark:text-gray-100">
          {getCurrencySymbol(currency)} {formatAmountDisplay(amount || '0')}
        </div>
      </div>

      {/* Tastierino */}
      <div className="flex gap-2">
        <div className="flex-1 grid grid-cols-3 gap-2">
          {['1','2','3','4','5','6','7','8','9'].map(n => (
            <button key={n} type="button" onClick={() => handleNumberClick(n)}
              className="h-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors">{n}</button>
          ))}
          <button type="button" onClick={() => setShowCurrencyPicker(true)}
            className="h-14 text-lg font-semibold rounded-lg bg-primary-100 dark:bg-primary-900/30 hover:bg-primary-200 dark:hover:bg-primary-900/50 text-primary-600 dark:text-primary-400 transition-colors">{getCurrencySymbol(currency)}</button>
          <button type="button" onClick={() => handleNumberClick('0')}
            className="h-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors">0</button>
          <button type="button" onClick={() => handleNumberClick('.')}
            className="h-14 text-2xl font-semibold rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors">,</button>
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" onClick={handleBackspace}
            className="h-14 w-14 rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5 5-5" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H7" />
            </svg>
          </button>
          <button type="submit" disabled={isLoading || !isStandardFormValid}
            className="flex-1 w-14 rounded-lg bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold text-3xl transition-colors flex items-center justify-center">
            {isLoading ? '...' : '✓'}
          </button>
          <button type="button" onClick={() => setShowDateSelector(true)}
            className="h-14 w-14 text-2xl rounded-lg bg-primary-100 dark:bg-primary-900/30 hover:bg-primary-200 dark:hover:bg-primary-900/50 text-primary-600 dark:text-primary-400 transition-colors">📅</button>
        </div>
      </div>

      {/* Data */}
      <div className="text-center text-sm text-gray-600 dark:text-gray-400">
        {formatDate(date)}
        {recurrence && (
          <span className="ml-2 inline-flex items-center gap-1 text-primary-600 dark:text-primary-400">
            🔄 {{ weekly: t('transactions.weeklyAbbr'), monthly: t('transactions.monthlyAbbr'), yearly: t('transactions.yearlyAbbr') }[recurrence]}
          </span>
        )}
      </div>

      {/* Descrizione */}
      <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder={t('transactions.description')}
        autoComplete="off" autoCorrect="off" spellCheck={false}
        className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm" />

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {isEditMode && onDelete && (
        <button type="button"
          onClick={() => isRecurring ? setShowRecurringDeleteModal(true) : setIsDeleteDialogOpen(true)}
          className="w-full px-4 py-2.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors text-sm font-medium flex items-center justify-center gap-2"
          disabled={isLoading}>
          <span className="text-base leading-none">🗑️</span>
          <span>{t('common.delete')}</span>
        </button>
      )}

      {/* Modal valuta */}
      <Modal isOpen={showCurrencyPicker} onClose={() => setShowCurrencyPicker(false)} title={t('transactions.selectCurrency')}>
        <div className="space-y-2">
          {[
            { code: 'EUR', symbol: '€' },
            { code: 'USD', symbol: '$' },
            { code: 'GBP', symbol: '£' },
            { code: 'JPY', symbol: '¥' },
            { code: 'CHF', symbol: 'Fr' },
          ].map((curr) => (
            <button key={curr.code} type="button"
              onClick={() => { setCurrency(curr.code); setShowCurrencyPicker(false); }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-colors ${currency === curr.code ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-primary-500'}`}>
              <span className="text-2xl font-bold w-12">{curr.symbol}</span>
              <div className="flex-1 text-left">
                <div className="font-medium text-gray-900 dark:text-gray-100">{t(`transactions.currencies.${curr.code}`)}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{curr.code}</div>
              </div>
            </button>
          ))}
        </div>
      </Modal>

      {sharedModals}
    </form>
  );
}
