import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';
import type { TransactionFormData, TransactionType, Category, Subcategory, Account, Portfolio, RecurringFrequency } from '../../types';
import { useData } from '../../contexts/DataContext';
import ConfirmDialog from '../common/ConfirmDialog';
import Modal, { registerBackHandler } from '../common/Modal';
import InvestmentOrderForm, { type InvestmentOrderInput } from '../investments/InvestmentOrderForm';

interface TransactionFormProps {
  onSubmit: (data: TransactionFormData) => Promise<void>;
  onCancel: () => void;
  initialData?: TransactionFormData;
  isEditMode?: boolean;
  onDelete?: () => Promise<void>;
  isRecurring?: boolean;
  onDeleteRecurringRule?: () => Promise<void>;
}

export default function TransactionForm({ onSubmit, onCancel, initialData, isEditMode, onDelete, isRecurring, onDeleteRecurringRule }: TransactionFormProps) {
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
    instrumentType: initialData?.instrument_type || 'etf',
  });
  const [isInvestmentDraftValid, setIsInvestmentDraftValid] = useState(false);

  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);

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
    } else {
      setSelectedPortfolio(allPortfolios[0] ?? null);
    }
  }, [isEditMode, currentType, allPortfolios]);

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
      instrumentType: initialData?.instrument_type || 'etf',
    });
  }, [currentType, initialData]);

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

    if (!selectedAccount) { setError(t('transactions.errorSelectAccount')); return; }

    let submitData: TransactionFormData;

    if (currentType === 'transfer') {
      if (!selectedToAccount) { setError(t('transactions.errorSelectDestination')); return; }
      if (selectedToAccount.id === selectedAccount.id) { setError(t('transactions.errorDifferentAccounts')); return; }
      const amountNum = parseFloat(amount) || 0;
      if (amountNum <= 0) { setError(t('transactions.errorInvalidAmount')); return; }
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
      const { quantity, price, commission, symbol, isin, name, exchange, instrumentType, ter, date: investmentDate } = investmentDraft;
      const total = quantity * price + commission;
      if (!isInvestmentDraftValid || total <= 0) { setError(t('transactions.errorQtyPrice')); return; }
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
        ter: ter || undefined,
      };
    } else {
      if (!selectedCategory) { setError(t('transactions.errorSelectCategory')); return; }
      const amountNum = parseFloat(amount) || 0;
      if (amountNum <= 0) { setError(t('transactions.errorInvalidAmount')); return; }
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

  const dateInputRef = useRef<HTMLInputElement>(null);

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

  const handleDateQuickSelect = (option: 'today' | 'yesterday') => {
    const today = new Date();
    if (option === 'today') {
      setDate(today.toISOString().split('T')[0]);
    } else {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      setDate(yesterday.toISOString().split('T')[0]);
    }
    setShowDateSelector(false);
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

      {/* Modal selettore data */}
      <Modal isOpen={showDateSelector} onClose={() => setShowDateSelector(false)} title={t('transactions.selectDate')}>
        <div className="space-y-2">
          <button type="button" onClick={() => handleDateQuickSelect('today')} className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 transition-colors">
            <span className="text-2xl">📅</span>
            <div className="flex-1 text-left">
              <div className="font-medium text-gray-900 dark:text-gray-100">{t('transactions.today')}</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">{new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
          </button>
          <button type="button" onClick={() => handleDateQuickSelect('yesterday')} className="w-full flex items-center gap-3 p-4 rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-primary-500 transition-colors">
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
            onChange={(e) => { if (e.target.value) { setDate(e.target.value); setShowDateSelector(false); } }}
            className="sr-only"
          />
          {!isEditMode && (
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('transactions.repeat')}</div>
              <div className="grid grid-cols-4 gap-2">
                {([null, 'weekly', 'monthly', 'yearly'] as const).map((freq) => {
                  const labels = { null: t('transactions.never'), weekly: t('transactions.weeklyAbbr'), monthly: t('transactions.monthlyAbbr'), yearly: t('transactions.yearlyAbbr') };
                  const key = freq ?? 'null';
                  return (
                    <button key={key} type="button" onClick={() => setRecurrence(freq)}
                      className={`py-2 rounded-lg text-sm font-medium transition-colors ${recurrence === freq ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                      {labels[key as keyof typeof labels]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>

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
    const total = investmentDraft.quantity * investmentDraft.price + investmentDraft.commission;
    const isInvestmentFormValid = Boolean(
      selectedAccount &&
      selectedPortfolio &&
      isInvestmentDraftValid &&
      total > 0
    );

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
          currency="EUR"
          showActions={false}
          initialData={{
            symbol: initialData?.ticker || '',
            isin: initialData?.isin,
            name: initialData?.instrument_name,
            exchange: initialData?.exchange,
            ter: initialData?.ter,
            quantity: initialData?.quantity || 0,
            price: initialData?.price || 0,
            commission: initialData?.quantity && initialData?.price ? Math.max(0, initialData.amount - (initialData.quantity * initialData.price)) : 0,
            date: initialData?.date || new Date().toISOString().split('T')[0],
            instrumentType: initialData?.instrument_type || 'etf',
          }}
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
          className="w-full py-4 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold text-lg transition-colors"
        >
          {isLoading ? t('transactions.saving') : isEditMode ? t('transactions.saveChanges') : t('transactions.addInvestment')}
        </button>

        {isEditMode && onDelete && (
          <button
            type="button"
            onClick={() => isRecurring ? setShowRecurringDeleteModal(true) : setIsDeleteDialogOpen(true)}
            className="w-full px-4 py-3 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium"
            disabled={isLoading}
          >
            🗑️ {t('common.delete')}
          </button>
        )}

        {sharedModals}
      </form>
    );
  }

  // ── Form trasferimento ────────────────────────────────────────────────────
  if (currentType === 'transfer') {
    return (
      <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
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
              className="h-14 w-14 text-2xl rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors">←</button>
            <button type="submit" disabled={isLoading || !selectedAccount || !selectedToAccount || parseFloat(amount) <= 0}
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
            className="w-full px-4 py-3 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium"
            disabled={isLoading}
          >
            🗑️ {t('common.delete')}
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
  return (
    <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
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
            className="h-14 w-14 text-2xl rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 transition-colors">←</button>
          <button type="submit" disabled={isLoading || !selectedCategory || !selectedAccount || parseFloat(amount) <= 0}
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
        {!isEditMode && recurrence && (
          <span className="ml-2 inline-flex items-center gap-1 text-primary-600 dark:text-primary-400">
            🔄 {{ weekly: t('transactions.weeklyAbbr'), monthly: t('transactions.monthlyAbbr'), yearly: t('transactions.yearlyAbbr') }[recurrence]}
          </span>
        )}
        {isEditMode && isRecurring && <span className="ml-2 text-primary-600 dark:text-primary-400">🔄</span>}
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
          className="w-full px-4 py-3 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium"
          disabled={isLoading}>
          🗑️ {t('common.delete')}
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
