import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TransactionDateModal from '../common/TransactionDateModal';
import type { RecurringFrequency } from '../../types';
const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';

export interface InvestmentOrderInput {
  symbol: string;
  isin?: string;
  name?: string;
  exchange?: string;
  ter?: number;
  quantity: number;
  price: number;
  commission: number;
  date: string;
  orderType?: 'buy' | 'sell';
  instrumentType?: 'etf' | 'stock' | 'bond';
}

interface InvestmentOrderFormProps {
  currency: string;
  onSubmit: (order: InvestmentOrderInput) => void | Promise<void>;
  onCancel: () => void;
  initialData?: InvestmentOrderInput;
  submitLabel?: string;
  onChange?: (order: InvestmentOrderInput, meta: { isValid: boolean }) => void;
  showActions?: boolean;
  existingOrders?: Array<{
    id?: number;
    transaction_id?: number;
    symbol: string;
    isin?: string;
    name?: string;
    exchange?: string;
    currency?: string;
    ter?: number;
    instrument_type?: string;
    instrumentType?: 'etf' | 'stock' | 'bond';
    quantity: number;
    order_type?: string;
    orderType?: 'buy' | 'sell';
  }>;
  ignoreOrderId?: number;
  ignoreTransactionId?: number;
  allowRecurring?: boolean;
  recurrence?: RecurringFrequency | null;
  onRecurrenceChange?: (frequency: RecurringFrequency | null) => void;
}

export default function InvestmentOrderForm({
  currency,
  onSubmit,
  onCancel,
  initialData,
  submitLabel,
  onChange,
  showActions = true,
  existingOrders = [],
  ignoreOrderId,
  ignoreTransactionId,
  allowRecurring = false,
  recurrence = null,
  onRecurrenceChange,
}: InvestmentOrderFormProps) {
  const { t } = useTranslation();
  const today = new Date().toISOString().split('T')[0];
  const initialNumberText = (value?: number) => (value != null && value !== 0 ? String(value) : '');
  const [symbol, setSymbol] = useState(initialData?.symbol || '');
  const [quantity, setQuantity] = useState(initialNumberText(initialData?.quantity));
  const [price, setPrice] = useState(initialNumberText(initialData?.price));
  const [date, setDate] = useState(initialData?.date || today);
  const [orderType, setOrderType] = useState<'buy' | 'sell'>(initialData?.orderType || 'buy');
  const [showDateSelector, setShowDateSelector] = useState(false);
  const currSymbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'Fr' };

  const [instrumentType, setInstrumentType] = useState<'etf' | 'stock' | 'bond'>(initialData?.instrumentType || 'etf');
  const [ucitsCache, setUcitsCache] = useState<any[]>([]);
  const [bondCache, setBondCache] = useState<any[]>([]);
  const [symbolOptions, setSymbolOptions] = useState<any[]>([]);
  const [symbolLoading, setSymbolLoading] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [symbolSearchCompleted, setSymbolSearchCompleted] = useState(false);
  const [isSymbolFocused, setIsSymbolFocused] = useState(false);
  const skipSymbolSearchRef = useRef(false);
  const [isinLookupLoading, setIsinLookupLoading] = useState(false);
  const [isinLookupError, setIsinLookupError] = useState(false);
  const [bondLookupLoading, setBondLookupLoading] = useState(false);
  const [bondLookupError, setBondLookupError] = useState(false);
  const [commission, setCommission] = useState(initialNumberText(initialData?.commission));
  const onChangeRef = useRef(onChange);
  const [selectedInfo, setSelectedInfo] = useState<{ isin?: string; name?: string; exchange?: string; ter?: number; currency?: string; coupon?: number; ytmGross?: number } | null>(
    initialData
      ? {
          isin: initialData.isin,
          name: initialData.name,
          exchange: initialData.exchange,
          ter: initialData.ter,
        }
      : null
  );
  const ucitsLoadedRef = useRef(false);
  const bondCacheLoadedRef = useRef(false);
  const isIsinStr = useCallback((s: string) => /^[A-Z]{2}[A-Z0-9]{10}$/.test(s), []);
  const getLookupKey = useCallback((params: {
    instrumentType: 'etf' | 'stock' | 'bond';
    symbol?: string;
    isin?: string;
    exchange?: string;
  }) => {
    if (params.instrumentType === 'bond') return (params.isin || params.symbol || '').trim().toUpperCase();
    const symbolPart = (params.symbol || '').trim().toUpperCase();
    const exchangePart = (params.exchange || '').trim().toUpperCase();
    return exchangePart ? `${symbolPart}|${exchangePart}` : symbolPart;
  }, []);
  const netQuantityByInstrumentKey = useMemo(() => (
    existingOrders
      .filter(order => order.id !== ignoreOrderId && order.transaction_id !== ignoreTransactionId)
      .filter(order => (order.instrument_type ?? order.instrumentType ?? 'etf') === instrumentType)
      .reduce<Record<string, number>>((acc, order) => {
        const currentOrderType = order.order_type ?? order.orderType ?? 'buy';
        const signedQuantity = currentOrderType === 'sell' ? -order.quantity : order.quantity;
        const lookupKey = getLookupKey({
          instrumentType,
          symbol: order.symbol,
          isin: order.isin,
          exchange: order.exchange,
        });
        if (!lookupKey) return acc;
        acc[lookupKey] = (acc[lookupKey] || 0) + signedQuantity;
        return acc;
      }, {})
  ), [existingOrders, ignoreOrderId, ignoreTransactionId, instrumentType, getLookupKey]);
  const availableKeysForCurrentInstrument = useMemo(() => (
    Object.entries(netQuantityByInstrumentKey)
      .filter(([, quantity]) => quantity > 0)
      .map(([key]) => key)
  ), [netQuantityByInstrumentKey]);
  const hasAvailableInstrumentToSell = availableKeysForCurrentInstrument.length > 0;
  const sellOptionsForCurrentInstrument = useMemo(() => {
    if (orderType !== 'sell') return [];
    const eligibleOrders = existingOrders.filter(order => (
      order.id !== ignoreOrderId &&
      order.transaction_id !== ignoreTransactionId &&
      (order.instrument_type ?? order.instrumentType ?? 'etf') === instrumentType
    ));

    if (instrumentType === 'bond') {
      return availableKeysForCurrentInstrument.map((lookupKey) => {
        const cachedBond = bondCache.find((bond) => getLookupKey({ instrumentType: 'bond', isin: bond.isin, symbol: bond.symbol }) === lookupKey);
        const sourceOrder = eligibleOrders.find((order) => getLookupKey({
          instrumentType: 'bond',
          symbol: order.symbol,
          isin: order.isin,
          exchange: order.exchange,
        }) === lookupKey);
        return {
          isin: sourceOrder?.isin || cachedBond?.isin || '',
          name: cachedBond?.name || sourceOrder?.name || sourceOrder?.symbol || '',
          issuer: cachedBond?.issuer || '',
          coupon: cachedBond?.coupon,
          ytm_gross: cachedBond?.ytm_gross,
          maturity: cachedBond?.maturity,
          currency: cachedBond?.currency || sourceOrder?.currency || 'EUR',
        };
      });
    }

    if (instrumentType === 'etf') {
      return availableKeysForCurrentInstrument.map((lookupKey) => {
        const cachedEtf = ucitsCache.find((item) => getLookupKey({
          instrumentType: 'etf',
          symbol: item.symbol,
          exchange: item.exchange,
          isin: item.isin,
        }) === lookupKey);
        const sourceOrder = eligibleOrders.find((order) => getLookupKey({
          instrumentType: 'etf',
          symbol: order.symbol,
          exchange: order.exchange,
          isin: order.isin,
        }) === lookupKey);
        return {
          symbol: sourceOrder?.symbol || cachedEtf?.symbol || '',
          isin: cachedEtf?.isin || sourceOrder?.isin,
          name: cachedEtf?.name || sourceOrder?.name || '',
          exchange: cachedEtf?.exchange || sourceOrder?.exchange || '',
          currency: cachedEtf?.currency || sourceOrder?.currency || currency,
          ter: cachedEtf?.ter ?? sourceOrder?.ter,
        };
      });
    }

    return availableKeysForCurrentInstrument.map((lookupKey) => {
      const sourceOrder = eligibleOrders.find((order) => getLookupKey({
        instrumentType: 'stock',
        symbol: order.symbol,
        exchange: order.exchange,
        isin: order.isin,
      }) === lookupKey);
      return {
        symbol: sourceOrder?.symbol || '',
        name: sourceOrder?.name || '',
        exchange: sourceOrder?.exchange || '',
        currency: sourceOrder?.currency || currency,
      };
    });
  }, [orderType, existingOrders, ignoreOrderId, ignoreTransactionId, instrumentType, availableKeysForCurrentInstrument, bondCache, ucitsCache, currency, getLookupKey]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (ucitsLoadedRef.current || ucitsCache.length > 0 || instrumentType !== 'etf') return;
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
  }, [instrumentType, ucitsCache.length]);

  useEffect(() => {
    if (instrumentType !== 'bond' || bondCacheLoadedRef.current || bondCache.length > 0) return;
    const cached = sessionStorage.getItem('bondCache');
    if (cached) {
      try { setBondCache(JSON.parse(cached)); bondCacheLoadedRef.current = true; return; } catch {}
    }
    bondCacheLoadedRef.current = true;
    fetch(`${PF_BACKEND_URL}/symbols/bonds`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.results) {
          setBondCache(data.results);
          try { sessionStorage.setItem('bondCache', JSON.stringify(data.results)); } catch {}
        }
      })
      .catch(() => { bondCacheLoadedRef.current = false; });
  }, [instrumentType, bondCache.length]);

  useEffect(() => {
    if (instrumentType !== 'bond' || bondCache.length === 0) return;
    const currentIsin = (selectedInfo?.isin || initialData?.isin || symbol).trim().toUpperCase();
    if (!currentIsin || !isIsinStr(currentIsin)) return;
    const cachedBond = bondCache.find((bond) => (bond.isin || '').trim().toUpperCase() === currentIsin);
    if (!cachedBond) return;

    setSelectedInfo((prev) => ({
      isin: currentIsin,
      name: prev?.name || cachedBond.name || cachedBond.issuer || currentIsin,
      exchange: prev?.exchange || 'MOT/EuroMOT',
      ter: prev?.ter,
      currency: prev?.currency || cachedBond.currency || 'EUR',
      coupon: prev?.coupon ?? cachedBond.coupon ?? undefined,
      ytmGross: prev?.ytmGross ?? cachedBond.ytm_gross ?? undefined,
    }));
  }, [instrumentType, bondCache, initialData?.isin, isIsinStr, selectedInfo?.isin, symbol]);

  useEffect(() => {
    if (skipSymbolSearchRef.current) { skipSymbolSearchRef.current = false; return; }
    if (orderType === 'sell' && !symbol) {
      setSymbolOptions(sellOptionsForCurrentInstrument.slice(0, 20));
      setSymbolSearchCompleted(true);
      setSymbolSearchOpen(isSymbolFocused && (sellOptionsForCurrentInstrument.length > 0 || !hasAvailableInstrumentToSell));
      setSymbolLoading(false);
      return;
    }
    if (!symbol || symbol.length < 2) {
      setSymbolOptions([]);
      setSymbolSearchCompleted(false);
      setSymbolSearchOpen(orderType === 'sell' && isSymbolFocused && !hasAvailableInstrumentToSell);
      return;
    }
    if (instrumentType === 'bond') {
      if (bondCache.length === 0) { setSymbolLoading(false); return; }
      const q = symbol.toUpperCase();
      const isIsin = /^[A-Z]{2}[A-Z0-9]{0,10}$/.test(q);
      const ql = symbol.toLowerCase();
      const filtered = bondCache.filter(b => {
        const isin = (b.isin || '').toUpperCase();
        const name = (b.name || '').toLowerCase();
        const issuer = (b.issuer || '').toLowerCase();
        const matchesQuery = isIsin ? isin.startsWith(q) : (name.includes(ql) || issuer.includes(ql));
        const matchesHolding = orderType !== 'sell' || availableKeysForCurrentInstrument.includes(getLookupKey({
          instrumentType: 'bond',
          symbol: b.symbol,
          isin: b.isin,
          exchange: b.exchange,
        }));
        return matchesQuery && matchesHolding;
      }).slice(0, 20);
      setSymbolOptions(filtered);
      setSymbolSearchOpen(isSymbolFocused && (filtered.length > 0 || (orderType === 'sell' && !hasAvailableInstrumentToSell)));
      setSymbolLoading(false);
      setSymbolSearchCompleted(true);
      return;
    }
    setSymbolSearchCompleted(false);
    const controller = new AbortController();
    const run = async () => {
      setSymbolLoading(true);
      if (instrumentType === 'etf') {
        await new Promise(r => setTimeout(r, 100));
        if (controller.signal.aborted) return;
        const q = symbol.toUpperCase();
        const filtered = ucitsCache.filter(item => {
          const sym = (item.symbol || '').toUpperCase();
          const isin = (item.isin || '').toUpperCase();
          const name = (item.name || '').toLowerCase();
          const matchesQuery = sym.startsWith(q) || name.includes(symbol.toLowerCase()) || (isIsinStr(q) && isin === q);
          const matchesHolding = orderType !== 'sell' || availableKeysForCurrentInstrument.includes(getLookupKey({
            instrumentType: 'etf',
            symbol: item.symbol,
            exchange: item.exchange,
            isin: item.isin,
          }));
          return matchesQuery && matchesHolding;
        }).slice(0, 25);
        setSymbolOptions(filtered);
        setSymbolSearchOpen(isSymbolFocused && (filtered.length > 0 || (orderType === 'sell' && !hasAvailableInstrumentToSell)));
        setSymbolLoading(false);
        setSymbolSearchCompleted(true);
        return;
      }
      try {
        const res = await fetch(
          `${PF_BACKEND_URL}/symbols/search?q=${encodeURIComponent(symbol)}&instrument_type=stock`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = await res.json();
          const results = (data.results || []).filter((item: any) => (
            orderType !== 'sell' || availableKeysForCurrentInstrument.includes(getLookupKey({
              instrumentType: 'stock',
              symbol: item.symbol,
              exchange: item.exchange,
              isin: item.isin,
            }))
          ));
          setSymbolOptions(results);
          setSymbolSearchOpen(isSymbolFocused && (results.length > 0 || (orderType === 'sell' && !hasAvailableInstrumentToSell)));
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') console.error('Symbol search error:', err);
      } finally {
        if (!controller.signal.aborted) { setSymbolLoading(false); setSymbolSearchCompleted(true); }
      }
    };
    const timer = setTimeout(run, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [symbol, instrumentType, ucitsCache, bondCache, isIsinStr, isSymbolFocused, orderType, availableKeysForCurrentInstrument, hasAvailableInstrumentToSell, sellOptionsForCurrentInstrument, getLookupKey]);

  const handleIsinLookup = async () => {
    setIsinLookupLoading(true);
    setIsinLookupError(false);
    try {
      const res = await fetch(`${PF_BACKEND_URL}/symbols/isin-lookup?isin=${symbol}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      const entries = data.listings.map((l: any) => ({
        symbol: l.ticker, isin: symbol, name: l.name, exchange: l.exchange, currency: l.currency, ter: l.ter,
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

  const handleBondLookup = async () => {
    const isin = symbol.toUpperCase().trim();
    if (!isIsinStr(isin)) return;
    setBondLookupLoading(true); setBondLookupError(false);
    try {
      const res = await fetch(`${PF_BACKEND_URL}/symbols/bond-lookup?isin=${encodeURIComponent(isin)}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      const metadata = data?.metadata;
      if (!metadata?.name && !metadata?.issuer && metadata?.coupon == null && metadata?.ytm_gross == null && !metadata?.maturity) {
        setBondLookupError(true);
        return;
      }
      const entry = {
        isin,
        name: metadata?.name || '',
        issuer: metadata?.issuer || '',
        coupon: metadata?.coupon ?? null,
        ytm_gross: metadata?.ytm_gross ?? null,
        maturity: metadata?.maturity ?? null,
        currency: metadata?.currency || 'EUR',
      };
      const updated = [...bondCache.filter(b => b.isin !== isin), entry];
      setBondCache(updated);
      try { sessionStorage.setItem('bondCache', JSON.stringify(updated)); } catch {}
      skipSymbolSearchRef.current = true;
      setSelectedInfo({
        isin,
        name: metadata?.name || metadata?.issuer || isin,
        exchange: 'MOT/EuroMOT',
        currency: metadata?.currency || 'EUR',
        coupon: metadata?.coupon,
        ytmGross: metadata?.ytm_gross,
      });
      setSymbol(isin);
      setSymbolOptions([]);
      setSymbolSearchCompleted(true);
      setSymbolSearchOpen(false);
    } catch { setBondLookupError(true); }
    finally { setBondLookupLoading(false); }
  };

  const formatDisplayDate = (d: string) => {
    if (!d) return t('transactions.selectDate');
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  const parsedQty = parseFloat(quantity.replace(',', '.')) || 0;
  const parsedPrice = parseFloat(price.replace(',', '.')) || 0;
  const parsedCommission = parseFloat((commission || '0').replace(',', '.')) || 0;
  const effectiveCurrency = selectedInfo?.currency || currency;
  const currSymbol = currSymbols[effectiveCurrency] || effectiveCurrency;
  const hasConfirmedSymbol = Boolean(selectedInfo && symbol.trim());
  const hasInvalidCommission = commission.trim().length > 0 && parsedCommission < 0;
  const normalizedInstrumentKey = getLookupKey({
    instrumentType,
    symbol,
    isin: selectedInfo?.isin,
    exchange: selectedInfo?.exchange,
  });
  const availableQuantity = existingOrders
    .filter(order => order.id !== ignoreOrderId && order.transaction_id !== ignoreTransactionId)
    .filter(order => getLookupKey({
      instrumentType,
      symbol: order.symbol,
      isin: order.isin,
      exchange: order.exchange,
    }) === normalizedInstrumentKey)
    .reduce((total, order) => {
      const currentOrderType = order.order_type ?? order.orderType ?? 'buy';
      const signedQuantity = currentOrderType === 'sell' ? -order.quantity : order.quantity;
      return total + signedQuantity;
    }, 0);
  const hasEnoughHoldings = orderType === 'buy' || (availableQuantity > 0 && parsedQty <= availableQuantity);
  const isOrderFormValid = hasConfirmedSymbol && parsedQty > 0 && parsedPrice > 0 && !hasInvalidCommission && hasEnoughHoldings;
  const sellNoMatchMessage = instrumentType === 'etf'
    ? t('transactions.etfNotInPortfolio')
    : instrumentType === 'stock'
      ? t('transactions.stockNotInPortfolio')
      : t('transactions.bondNotInPortfolio');

  useEffect(() => {
    onChangeRef.current?.({
      symbol: symbol.trim().toUpperCase(),
      isin: selectedInfo?.isin,
      name: selectedInfo?.name,
      exchange: selectedInfo?.exchange,
      ter: selectedInfo?.ter,
      quantity: parsedQty,
      price: parsedPrice,
      commission: parsedCommission,
      date,
      orderType,
      instrumentType,
    }, { isValid: isOrderFormValid });
  }, [symbol, selectedInfo, parsedQty, parsedPrice, parsedCommission, date, orderType, instrumentType, isOrderFormValid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOrderFormValid) return;
    await onSubmit({
      symbol: symbol.trim().toUpperCase(),
      isin: selectedInfo?.isin,
      name: selectedInfo?.name,
      exchange: selectedInfo?.exchange,
      ter: selectedInfo?.ter,
      quantity: parsedQty,
      price: parsedPrice,
      commission: parsedCommission,
      date,
      orderType,
      instrumentType,
    });
  };

  const formatPercent = (value?: number) => {
    if (value == null) return '';
    return `${value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  };

  const content = (
    <div className="space-y-4">
      <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
        {(['buy', 'sell'] as const).map(type => (
          <button
            key={type}
            type="button"
            onClick={() => setOrderType(type)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${orderType === type ? (type === 'buy' ? 'bg-green-500 text-white' : 'bg-red-500 text-white') : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            {type === 'buy' ? t('transactions.buy') : t('transactions.sell')}
          </button>
        ))}
      </div>

      <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
        {(['etf', 'stock', 'bond'] as const).map(typ => (
          <button
            key={typ}
            type="button"
            onClick={() => { setInstrumentType(typ); setSymbol(''); setSymbolOptions([]); setSymbolSearchCompleted(false); setBondLookupError(false); setIsinLookupError(false); setSelectedInfo(null); }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${instrumentType === typ ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            {typ === 'etf' ? 'ETF' : typ === 'stock' ? 'Stock' : 'Bond'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div className="relative">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            {instrumentType === 'etf' ? t('transactions.tickerOrIsin') : instrumentType === 'stock' ? t('transactions.tickerOrName') : 'ISIN'}
          </label>
          <div className="relative">
            <input
              type="text"
              value={symbol}
              onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setIsinLookupError(false); setBondLookupError(false); setSelectedInfo(null); }}
              placeholder={instrumentType === 'etf' ? 'Es. VWCE, SWDA' : instrumentType === 'stock' ? 'Es. AAPL, MSFT' : 'Es. IT0005398406'}
              className={'w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-base uppercase tracking-wider font-mono' + (symbolLoading ? ' pr-8' : '')}
              onFocus={() => {
                setIsSymbolFocused(true);
                if (orderType === 'sell') {
                  setSymbolSearchOpen(true);
                } else if (symbolOptions.length > 0) {
                  setSymbolSearchOpen(true);
                }
              }}
              onBlur={() => setTimeout(() => { setIsSymbolFocused(false); setSymbolSearchOpen(false); }, 150)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              autoCapitalize="characters"
              required
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

          {orderType === 'sell' && isSymbolFocused && !symbolLoading && !hasAvailableInstrumentToSell && (
            <div className="absolute z-20 mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 shadow-xl">
              <div className="px-3 py-3 text-center text-xs text-gray-500 dark:text-gray-400">
                {instrumentType === 'etf'
                  ? t('transactions.noEtfInPortfolio')
                  : instrumentType === 'stock'
                    ? t('transactions.noStockInPortfolio')
                    : t('transactions.noBondInPortfolio')}
              </div>
            </div>
          )}

          {symbolSearchOpen && ((orderType === 'sell' && symbol.length === 0) || symbol.length >= 2) && !symbolLoading && symbolSearchCompleted && symbolOptions.length > 0 && (
            <div className="absolute z-20 mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg max-h-52 overflow-auto bg-white dark:bg-gray-900 shadow-xl">
              {symbolOptions.map((opt: any, i: number) => (
                <button
                  key={i}
                  type="button"
                  onMouseDown={() => {
                    if (instrumentType === 'bond') {
                      setSymbol(opt.isin || '');
                      setSelectedInfo({
                        isin: opt.isin,
                        name: opt.name || opt.issuer || '',
                        exchange: 'MOT/EuroMOT',
                        currency: opt.currency || 'EUR',
                        coupon: opt.coupon,
                        ytmGross: opt.ytm_gross,
                      });
                    } else {
                      setSymbol(opt.symbol);
                      setSelectedInfo({
                        isin: opt.isin,
                        name: opt.name || '',
                        exchange: opt.exchange || '',
                        ter: instrumentType === 'etf' ? opt.ter : undefined,
                        currency: opt.currency || currency,
                      });
                    }
                    setSymbolOptions([]);
                    setSymbolSearchOpen(false);
                    skipSymbolSearchRef.current = true;
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-left border-b border-gray-100 dark:border-gray-800 last:border-0"
                >
                  {instrumentType === 'bond' ? (
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-sm text-gray-900 dark:text-gray-100">{opt.isin}</span>
                      {(opt.name || opt.issuer) && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{opt.name || opt.issuer}</p>}
                      <div className="flex gap-2 text-xs text-gray-400 mt-0.5">
                        {opt.maturity && <span>Sc. {opt.maturity}</span>}
                        {opt.coupon != null && <span>{opt.coupon}%</span>}
                        {opt.currency && <span className="text-blue-500">{opt.currency}</span>}
                      </div>
                    </div>
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
              ))}
            </div>
          )}

          {instrumentType !== 'bond' && symbolSearchOpen && symbol.length >= 2 && !symbolLoading && symbolSearchCompleted && symbolOptions.length === 0 && (
            <div className="absolute z-20 mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 shadow-xl">
              <div className="px-3 py-3 text-center text-xs text-gray-500 dark:text-gray-400">
                {orderType === 'sell' ? (
                  <span>{hasAvailableInstrumentToSell ? sellNoMatchMessage : (instrumentType === 'etf' ? t('transactions.noEtfInPortfolio') : t('transactions.noStockInPortfolio'))}</span>
                ) : isIsinStr(symbol) ? (
                  <div className="flex flex-col items-center gap-2">
                    <span>{t('transactions.isinNotCached')}</span>
                    {isinLookupError && <span className="text-red-500">{t('transactions.isinNotFound')}</span>}
                    <button
                      type="button"
                      onMouseDown={handleIsinLookup}
                      disabled={isinLookupLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-60 transition text-xs"
                    >
                      {isinLookupLoading && <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
                      {isinLookupLoading ? t('transactions.searching') : t('transactions.searchJustEtf')}
                    </button>
                  </div>
                ) : (
                  <span>{t('transactions.noResults')}</span>
                )}
              </div>
            </div>
          )}

          {instrumentType === 'bond' && orderType === 'sell' && symbolSearchOpen && symbol.length >= 2 && !symbolLoading && symbolSearchCompleted && symbolOptions.length === 0 && hasAvailableInstrumentToSell && (
            <div className="absolute z-20 mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 shadow-xl">
              <div className="px-3 py-3 text-center text-xs text-gray-500 dark:text-gray-400">
                {sellNoMatchMessage}
              </div>
            </div>
          )}

          {instrumentType === 'bond' && orderType !== 'sell' && isIsinStr(symbol.trim().toUpperCase()) && symbolSearchCompleted && symbolOptions.length === 0 && !selectedInfo && (
            <div className="absolute z-20 mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
              <button
                type="button"
                onMouseDown={handleBondLookup}
                disabled={bondLookupLoading}
                className="w-full px-3 py-2 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left disabled:opacity-50"
              >
                {bondLookupLoading ? 'Ricerca...' : `Cerca obbligazione: ${symbol}`}
              </button>
              {bondLookupError && <div className="px-3 py-1.5 text-xs text-red-500">Non trovato</div>}
            </div>
          )}
        </div>
      </div>

      {selectedInfo?.name && (
        <div className="p-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div><span className="text-gray-400">Nome</span><div className="font-medium text-gray-900 dark:text-gray-100 truncate">{selectedInfo.name}</div></div>
          {selectedInfo.exchange && <div><span className="text-gray-400">Exchange</span><div className="font-medium text-gray-900 dark:text-gray-100">{selectedInfo.exchange}</div></div>}
          {instrumentType === 'etf' && selectedInfo.ter != null && <div><span className="text-gray-400">TER</span><div className="font-medium text-gray-900 dark:text-gray-100">{selectedInfo.ter}%</div></div>}
          {instrumentType === 'bond' && selectedInfo.coupon != null && <div><span className="text-gray-400">Coupon</span><div className="font-medium text-gray-900 dark:text-gray-100">{formatPercent(selectedInfo.coupon)}</div></div>}
          {instrumentType === 'bond' && selectedInfo.ytmGross != null && <div><span className="text-gray-400">YTM gross</span><div className="font-medium text-gray-900 dark:text-gray-100">{formatPercent(selectedInfo.ytmGross)}</div></div>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('transactions.quantity')}</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-base"
            placeholder="0"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('transactions.priceShort')} ({currSymbol})</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={price}
            onChange={e => setPrice(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-base"
            placeholder="0,00"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('transactions.commission')} ({currSymbol})</label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={commission}
            onChange={e => setCommission(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-base"
            placeholder="0,00"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
            {t('transactions.total')}
          </div>
          <div className={`mt-0.5 text-2xl font-bold leading-none truncate ${parsedQty > 0 && parsedPrice > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
            {currSymbol} {(parsedQty * parsedPrice + parsedCommission).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowDateSelector(true)}
          className="shrink-0 flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-700 dark:text-gray-300 hover:border-primary-500 transition-colors"
        >
          <span className="text-base leading-none">📅</span>
          <div className="text-left">
            <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
              {t('transactions.date')}
            </div>
            <div className="text-sm font-medium leading-tight">{formatDisplayDate(date)}</div>
          </div>
        </button>
      </div>

      <TransactionDateModal
        isOpen={showDateSelector}
        onClose={() => setShowDateSelector(false)}
        date={date}
        onDateChange={setDate}
        allowRecurring={allowRecurring}
        recurrence={recurrence}
        onRecurrenceChange={onRecurrenceChange}
      />

      {showActions && (
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onCancel} className="flex-1 btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={!isOrderFormValid} className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
            {submitLabel || t('common.add')}
          </button>
        </div>
      )}
    </div>
  );

  if (showActions) {
    return (
      <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
        {content}
      </form>
    );
  }

  return content;
}
