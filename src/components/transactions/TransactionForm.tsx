import { useState, useEffect, useMemo, useRef, useCallback, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';
import type { TransactionFormData, TransactionType, Category, Subcategory, Account, Portfolio, RecurringFrequency } from '../../types';
import { useData } from '../../contexts/DataContext';
import ConfirmDialog from '../common/ConfirmDialog';
import Modal, { registerBackHandler } from '../common/Modal';

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
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [currency, setCurrency] = useState<string>('EUR');

  // Campi investimento
  const [ticker, setTicker] = useState<string>(initialData?.ticker || '');
  const [investQty, setInvestQty] = useState<string>(initialData?.quantity?.toString() || '');
  const [investPrice, setInvestPrice] = useState<string>(initialData?.price?.toString() || '');
  const [investCommission, setInvestCommission] = useState<string>(() => {
    if (initialData?.quantity && initialData?.price) {
      const commission = (initialData.amount) - (initialData.quantity * initialData.price);
      return commission > 0 ? commission.toFixed(2) : '';
    }
    return '';
  });

  // Symbol search
  const [instrumentType, setInstrumentType] = useState<'etf' | 'stock' | 'bond'>('etf');
  const [ucitsCache, setUcitsCache] = useState<any[]>([]);
  const [symbolOptions, setSymbolOptions] = useState<any[]>([]);
  const [symbolLoading, setSymbolLoading] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [symbolSearchCompleted, setSymbolSearchCompleted] = useState(false);
  const [selectedSymbolInfo, setSelectedSymbolInfo] = useState<{ name: string; exchange: string; currency: string; ter: string; isin: string } | null>(null);
  const skipSymbolSearchRef = useRef(false);
  const [isinLookupLoading, setIsinLookupLoading] = useState(false);
  const [isinLookupError, setIsinLookupError] = useState(false);
  const ucitsLoadedRef = useRef(false);
  const [bondCache, setBondCache] = useState<any[]>([]);
  const bondCacheLoadedRef = useRef(false);
  const [bondMeta, setBondMeta] = useState<any>(null);
  const [bondLookupLoading, setBondLookupLoading] = useState(false);
  const [bondLookupError, setBondLookupError] = useState(false);

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

  // Account preferito di default
  useEffect(() => {
    if (!selectedAccount && allAccounts.length > 0) {
      const favoriteAccount = allAccounts.find(acc => acc.is_favorite);
      setSelectedAccount(favoriteAccount || allAccounts[0]);
    }
  }, [allAccounts, selectedAccount]);

  // Reset categoria quando cambia tipo (non per investment → si auto-seleziona)
  useEffect(() => {
    setSelectedCategory(null);
    setSelectedSubcategory(null);
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

  // Auto-seleziona portafoglio quando cambia categoria investimento
  useEffect(() => {
    if (currentType !== 'investment' || allPortfolios.length === 0) return;
    if (isEditMode && initialData?.portfolio_id) {
      const p = allPortfolios.find(p => p.id === initialData.portfolio_id);
      if (p) { setSelectedPortfolio(p); return; }
    }
    if (selectedCategory) {
      const linked = allPortfolios.find(p => p.category_id === selectedCategory.id);
      setSelectedPortfolio(linked ?? allPortfolios[0] ?? null);
    }
  }, [selectedCategory, currentType, allPortfolios]);

  // Carica ETF UCITS cache (sessionStorage → API)
  useEffect(() => {
    if (ucitsLoadedRef.current || ucitsCache.length > 0 || currentType !== 'investment') return;
    const cached = sessionStorage.getItem('ucits_etf_list');
    if (cached) {
      try { setUcitsCache(JSON.parse(cached)); ucitsLoadedRef.current = true; return; } catch {}
    }
    ucitsLoadedRef.current = true;
    fetch(`${PF_BACKEND_URL}/symbols/ucits`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.results) {
          setUcitsCache(data.results);
          try { sessionStorage.setItem('ucits_etf_list', JSON.stringify(data.results)); } catch {}
        }
      })
      .catch(() => { ucitsLoadedRef.current = false; });
  }, [currentType, ucitsCache.length]);

  // Bond cache
  useEffect(() => {
    if (bondCacheLoadedRef.current || bondCache.length > 0) return;
    const cached = sessionStorage.getItem('bond_metadata_list');
    if (cached) {
      try { setBondCache(JSON.parse(cached)); return; } catch {}
    }
    bondCacheLoadedRef.current = true;
    fetch(`${PF_BACKEND_URL}/symbols/bonds`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.results) {
          setBondCache(data.results);
          try { sessionStorage.setItem('bond_metadata_list', JSON.stringify(data.results)); } catch {}
        }
      })
      .catch(() => { bondCacheLoadedRef.current = false; });
  }, [bondCache.length]);

  // Ricerca simboli con debounce
  const isIsinStr = useCallback((s: string) => /^[A-Z]{2}[A-Z0-9]{10}$/.test(s), []);
  useEffect(() => {
    if (skipSymbolSearchRef.current) { skipSymbolSearchRef.current = false; return; }
    if (!ticker || ticker.length < 2) {
      setSymbolOptions([]);
      setSymbolSearchCompleted(false);
      setSymbolSearchOpen(false);
      return;
    }
    setSymbolSearchCompleted(false);
    const controller = new AbortController();

    const run = async () => {
      setSymbolLoading(true);
      if (instrumentType === 'bond') {
        await new Promise(r => setTimeout(r, 100));
        if (controller.signal.aborted) return;
        const q = ticker.toUpperCase();
        const filtered = bondCache.filter((item: any) => {
          const isin = (item.isin || '').toUpperCase();
          const name = (item.name || '').toUpperCase();
          const issuer = (item.issuer || '').toUpperCase();
          return isin.startsWith(q) || (q.length >= 3 && (name.includes(q) || issuer.includes(q)));
        }).slice(0, 15);
        setSymbolOptions(filtered);
        setSymbolSearchOpen(true);
        setSymbolLoading(false);
        setSymbolSearchCompleted(true);
        return;
      }
      if (instrumentType === 'etf') {
        await new Promise(r => setTimeout(r, 100));
        if (controller.signal.aborted) return;
        const q = ticker.toUpperCase();
        const filtered = ucitsCache.filter(item => {
          const t = (item.symbol || '').toUpperCase();
          const isin = (item.isin || '').toUpperCase();
          return t.startsWith(q) || (isIsinStr(q) && isin === q);
        }).slice(0, 25);
        setSymbolOptions(filtered);
        setSymbolSearchOpen(true);
        setSymbolLoading(false);
        setSymbolSearchCompleted(true);
        return;
      }
      try {
        const res = await fetch(
          `${PF_BACKEND_URL}/symbols/search?q=${encodeURIComponent(ticker)}&instrument_type=stock`,
          { signal: controller.signal }
        );
        if (res.ok) { const data = await res.json(); setSymbolOptions(data.results || []); setSymbolSearchOpen(true); }
      } catch (err: any) {
        if (err.name !== 'AbortError') console.error('Symbol search error:', err);
      } finally {
        if (!controller.signal.aborted) { setSymbolLoading(false); setSymbolSearchCompleted(true); }
      }
    };
    const timer = setTimeout(run, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [ticker, instrumentType, ucitsCache, bondCache, isIsinStr]);

  const handleBondLookup = async () => {
    setBondLookupLoading(true);
    setBondLookupError(false);
    setBondMeta(null);
    try {
      const res = await fetch(`${PF_BACKEND_URL}/symbols/bond-lookup?isin=${ticker}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      const meta = data.metadata || {};
      setBondMeta(meta);
      setSelectedSymbolInfo({
        name: meta.name || meta.issuer || '',
        exchange: 'MOT/EuroMOT',
        currency: meta.currency || 'EUR',
        ter: '',
        isin: ticker,
      });
      // Aggiorna cache locale e sessionStorage
      setBondCache(prev => {
        const entry = { ...meta, isin: ticker };
        const exists = prev.find((b: any) => b.isin === ticker);
        const updated = exists ? prev.map((b: any) => b.isin === ticker ? entry : b) : [...prev, entry];
        try { sessionStorage.setItem('bond_metadata_list', JSON.stringify(updated)); } catch {}
        return updated;
      });
      setSymbolOptions([]);
      setSymbolSearchOpen(false);
    } catch {
      setBondLookupError(true);
    } finally {
      setBondLookupLoading(false);
    }
  };

  const handleIsinLookup = async () => {
    setIsinLookupLoading(true);
    setIsinLookupError(false);
    try {
      const res = await fetch(`${PF_BACKEND_URL}/symbols/isin-lookup?isin=${ticker}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      const entries = data.listings.map((l: any) => ({
        symbol: l.ticker, isin: ticker, name: l.name, exchange: l.exchange, currency: l.currency, ter: l.ter,
      }));
      setUcitsCache(prev => [...prev, ...entries]);
      setSymbolOptions(entries);
      setSymbolSearchOpen(true);
      setSymbolSearchCompleted(true);
    } catch {
      setIsinLookupError(true);
    } finally {
      setIsinLookupLoading(false);
    }
  };

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
      const qty = parseFloat(investQty) || 0;
      const price = parseFloat(investPrice) || 0;
      const commission = parseFloat(investCommission) || 0;
      const total = qty * price + commission;
      if (total <= 0) { setError(t('transactions.errorQtyPrice')); return; }
      if (!selectedCategory) { setError(t('transactions.errorSelectCategory')); return; }
      submitData = {
        type: currentType,
        category: selectedCategory.name,
        amount: total,
        description,
        date,
        account_id: selectedAccount.id,
        ticker: ticker.trim().toUpperCase() || undefined,
        quantity: qty || undefined,
        price: price || undefined,
        portfolio_id: selectedPortfolio?.id,
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
    <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
      {typeButtons.map(({ type, label, icon }) => (
        <button
          key={type}
          type="button"
          onClick={() => setCurrentType(type)}
          className={`flex-1 px-3 py-2 font-medium text-sm transition-colors flex flex-col items-center ${
            currentType === type
              ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400'
              : 'text-gray-600 dark:text-gray-400'
          }`}
        >
          <span className="text-xl mb-0.5">{icon}</span>
          <span>{label}</span>
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

  // ── Form investimento — mostrato solo dopo selezione categoria ─────────────
  // (il blocco !selectedCategory qui sopra gestisce la griglia per tutti i tipi)
  if (currentType === 'investment' && selectedCategory) {
    const qty = parseFloat(investQty) || 0;
    const price = parseFloat(investPrice) || 0;
    const commission = parseFloat(investCommission) || 0;
    const total = qty * price + commission;

    const inputClass = "w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-base";
    const noFill = { autoComplete: "off", autoCorrect: "off", spellCheck: false } as const;
    const labelClass = "block text-xs text-gray-500 dark:text-gray-400 mb-1";

    return (
      <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
        {/* Categoria + Conto */}
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowCategoryPicker(true)}
            className="flex-1 flex items-center gap-2 p-3 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-primary-500 transition-colors">
            <span className="text-2xl">{selectedCategory?.icon || '📈'}</span>
            <div className="flex-1 text-left">
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('transactions.category')}</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{selectedCategory?.name || '...'}</div>
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

        {/* ETF / Stock / Bond toggle */}
        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
          {(['etf', 'stock', 'bond'] as const).map(inst => (
            <button
              key={inst}
              type="button"
              onClick={() => {
                setInstrumentType(inst);
                setTicker('');
                setSelectedSymbolInfo(null);
                setSymbolOptions([]);
                setSymbolSearchCompleted(false);
                setBondMeta(null);
                setBondLookupError(false);
              }}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${instrumentType === inst ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >
              {inst === 'etf' ? 'ETF' : inst === 'stock' ? 'Stock' : 'Bond'}
            </button>
          ))}
        </div>

        {/* Ticker + Quantità */}
        <div className="grid grid-cols-2 gap-3">
          <div className="relative">
            <label className={labelClass}>
              {instrumentType === 'etf' ? t('transactions.tickerOrIsin') : instrumentType === 'bond' ? 'ISIN' : t('transactions.tickerOrName')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={ticker}
                onChange={(e) => {
                  setTicker(e.target.value.toUpperCase());
                  setSelectedSymbolInfo(null);
                  setIsinLookupError(false);
                  setBondMeta(null);
                  setBondLookupError(false);
                }}
                placeholder={instrumentType === 'etf' ? 'Es. VWCE, SWDA' : instrumentType === 'bond' ? 'Es. IT0005398406' : 'Es. AAPL, MSFT'}
                className={inputClass + ' uppercase tracking-wider font-mono' + (symbolLoading ? ' pr-8' : '')}
                onFocus={() => { if (symbolOptions.length > 0) setSymbolSearchOpen(true); }}
                onBlur={() => setTimeout(() => setSymbolSearchOpen(false), 150)}
                {...noFill}
              />
              {symbolLoading && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                </div>
              )}
            </div>

            {/* Dropdown risultati */}
            {symbolSearchOpen && ticker.length >= 2 && !symbolLoading && symbolSearchCompleted && (
              <div className="absolute z-20 mt-1 w-64 border border-gray-200 dark:border-gray-700 rounded-lg max-h-52 overflow-auto bg-white dark:bg-gray-900 shadow-xl">
                {symbolOptions.length > 0 ? symbolOptions.map((opt: any) => {
                  const isBond = instrumentType === 'bond';
                  const key = isBond ? opt.isin : `${opt.symbol}-${opt.exchange || ''}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      onMouseDown={() => {
                        if (isBond) {
                          setTicker(opt.isin);
                          setSelectedSymbolInfo({ name: opt.name || opt.issuer || '', exchange: 'MOT/EuroMOT', currency: opt.currency || 'EUR', ter: '', isin: opt.isin });
                          setBondMeta(opt);
                        } else {
                          setTicker(opt.symbol);
                          setSelectedSymbolInfo({ name: opt.name || '', exchange: opt.exchange || '', currency: opt.currency || '', ter: opt.ter || '', isin: opt.isin || '' });
                        }
                        setSymbolOptions([]);
                        setSymbolSearchOpen(false);
                        skipSymbolSearchRef.current = true;
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-left border-b border-gray-100 dark:border-gray-800 last:border-0"
                    >
                      {isBond ? (
                        <>
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{opt.name || opt.isin}</p>
                            {opt.issuer && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{opt.issuer}</p>}
                          </div>
                          <div className="flex flex-col items-end gap-0.5 ml-2 shrink-0 text-xs text-gray-400">
                            {opt.maturity && <span>Scad. {opt.maturity}</span>}
                            {opt.coupon != null && <span className="font-medium">{opt.coupon}%</span>}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <span className="font-mono font-bold text-sm text-gray-900 dark:text-gray-100">{opt.symbol}</span>
                            {opt.name && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{opt.name}</p>}
                          </div>
                          <div className="flex flex-col items-end gap-0.5 ml-2 shrink-0 text-xs text-gray-400">
                            {opt.exchange && <span>{opt.exchange}</span>}
                            {opt.currency && <span className="font-medium">{opt.currency}</span>}
                          </div>
                        </>
                      )}
                    </button>
                  );
                }) : (
                  <div className="px-3 py-3 text-center text-xs text-gray-500 dark:text-gray-400">
                    {instrumentType === 'bond' && isIsinStr(ticker) ? (
                      <div className="flex flex-col items-center gap-2">
                        <span>Obbligazione non in cache</span>
                        {bondLookupError && <span className="text-red-500">Non trovata su Borsa Italiana</span>}
                        <button
                          type="button"
                          onMouseDown={handleBondLookup}
                          disabled={bondLookupLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-60 transition text-xs"
                        >
                          {bondLookupLoading && (
                            <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                          )}
                          {bondLookupLoading ? t('transactions.searching') : 'Cerca obbligazione'}
                        </button>
                      </div>
                    ) : isIsinStr(ticker) ? (
                      <div className="flex flex-col items-center gap-2">
                        <span>{t('transactions.isinNotCached')}</span>
                        {isinLookupError && <span className="text-red-500">{t('transactions.isinNotFound')}</span>}
                        <button
                          type="button"
                          onMouseDown={handleIsinLookup}
                          disabled={isinLookupLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-60 transition text-xs"
                        >
                          {isinLookupLoading && (
                            <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                            </svg>
                          )}
                          {isinLookupLoading ? t('transactions.searching') : t('transactions.searchJustEtf')}
                        </button>
                      </div>
                    ) : t('transactions.noResults')}
                  </div>
                )}
              </div>
            )}

            {/* Info asset selezionato */}
            {selectedSymbolInfo?.name && (
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                {selectedSymbolInfo.name}
                {selectedSymbolInfo.exchange && ` · ${selectedSymbolInfo.exchange}`}
                {selectedSymbolInfo.currency && ` · ${selectedSymbolInfo.currency}`}
                {selectedSymbolInfo.ter && ` · TER ${selectedSymbolInfo.ter}%`}
              </div>
            )}
          </div>

          <div>
            <label className={labelClass}>{instrumentType === 'bond' ? 'Nominale (€)' : t('transactions.quantity')}</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={investQty}
              onChange={(e) => setInvestQty(e.target.value)}
              placeholder="0"
              className={inputClass}
              {...noFill}
            />
          </div>
        </div>

        {/* Bond metadata panel */}
        {bondMeta && (
          <div className="grid grid-cols-2 gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-xs">
            {bondMeta.issuer && (
              <div><span className="text-gray-500 dark:text-gray-400">Emittente</span><div className="font-medium text-gray-900 dark:text-gray-100 truncate">{bondMeta.issuer}</div></div>
            )}
            {bondMeta.coupon != null && (
              <div><span className="text-gray-500 dark:text-gray-400">Cedola</span><div className="font-medium text-gray-900 dark:text-gray-100">{bondMeta.coupon}%</div></div>
            )}
            {(bondMeta.maturity || bondMeta.maturity_bi) && (
              <div><span className="text-gray-500 dark:text-gray-400">Scadenza</span><div className="font-medium text-gray-900 dark:text-gray-100">{bondMeta.maturity_bi || bondMeta.maturity}</div></div>
            )}
            {bondMeta.ytm_gross != null && (
              <div><span className="text-gray-500 dark:text-gray-400">YTM lordo</span><div className="font-medium text-gray-900 dark:text-gray-100">{bondMeta.ytm_gross}%</div></div>
            )}
            {bondMeta.ytm_net != null && (
              <div><span className="text-gray-500 dark:text-gray-400">YTM netto</span><div className="font-medium text-gray-900 dark:text-gray-100">{bondMeta.ytm_net}%</div></div>
            )}
            {bondMeta.duration != null && (
              <div><span className="text-gray-500 dark:text-gray-400">Duration</span><div className="font-medium text-gray-900 dark:text-gray-100">{bondMeta.duration}</div></div>
            )}
          </div>
        )}

        {/* Prezzo + Commissioni */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              {instrumentType === 'bond' ? 'Price (% of par)' : `${t('transactions.pricePerUnit')} (${selectedSymbolInfo?.currency ? getCurrencySymbol(selectedSymbolInfo.currency) : '€'})`}
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={investPrice}
              onChange={(e) => setInvestPrice(e.target.value)}
              placeholder="0,00"
              className={inputClass}
              {...noFill}
            />
          </div>
          <div>
            <label className={labelClass}>{t('transactions.commission')}</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={investCommission}
              onChange={(e) => setInvestCommission(e.target.value)}
              placeholder="0,00"
              className={inputClass}
              {...noFill}
            />
          </div>
        </div>

        {/* Totale calcolato */}
        <div className="text-center py-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('transactions.total')}</div>
          <div className={`text-4xl font-bold ${total > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
            {formatCurrency(total)}
          </div>
          {qty > 0 && price > 0 && commission > 0 && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {qty} × {formatCurrency(price)} + {formatCurrency(commission)} {t('transactions.commissions')}
            </div>
          )}
          {instrumentType === 'bond' && qty > 0 && price > 0 && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {qty}€ × {price}% / 100 = {formatCurrency(qty * price / 100)}
            </div>
          )}
        </div>

        {/* Data */}
        <button type="button" onClick={() => setShowDateSelector(true)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-primary-500 transition-colors">
          <span className="flex items-center gap-2">
            <span>📅</span>
            <span className="text-sm">{formatDate(date)}</span>
          </span>
          <span className="text-gray-400">›</span>
        </button>

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
          disabled={isLoading || total <= 0 || !selectedAccount}
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
