import { useState, useRef, useEffect } from 'react';
import { useConfirm } from '../hooks/useConfirm';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { apiService } from '../services/api';
import { getNextDueDate } from '../services/recurring';
import { useData } from '../contexts/DataContext';
import type { RecurringFrequency } from '../types';

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';

// ── Kakebo internal types ──────────────────────────────────────────────────────

interface KConto { id: number; nome: string; tipo: number; variazioneSaldo1: number; }
interface KCategoria { id: number; padreId: number | null; tipoMovimento: number; nome: string; }
interface KMovimento {
  id: number; contoId: number; categoriaId: number | null; sottocategoriaId: number | null;
  dataOperazione: number; note: string | null; tipo: number; contoPrelievoId: number | null; importo1: number;
  numeroRipetizioni?: number | null; calendarField?: number | null;
}
interface ParsedDB { conti: KConto[]; categorie: KCategoria[]; movimenti: KMovimento[]; }

interface RecurringDraft {
  movimentoId: number;
  enabled: boolean;
  type: 'expense' | 'income' | 'investment';
  sourceContoId: number;
  portfolioContoId?: number;
  accountName: string;
  portfolioName?: string;
  category: string;
  subcategory?: string | null;
  amount: string;
  description: string;
  startDate: string;
  frequency: RecurringFrequency;
}

// Mode A: one entry per individual investment transfer
interface InvDetail {
  movimentoId: number;
  sourceKind: 'transfer' | 'bonus';
  date: string;
  amount: number;
  description: string | null;
  destContoId: number;
  instrumentType: 'etf' | 'stock' | 'bond';
  ticker: string;
  quantity: string;
  price: string;
  commission: string;
  isin: string;
  name: string;
  exchange: string;
  ter: string;
}

// Mode B: one entry per position (multiple per portfolio allowed)
interface InvPosition {
  id: string;
  contoId: number;
  totalAmount: number;    // portfolio-level, for display
  transferCount: number;  // portfolio-level, for display
  lastDate: string;
  instrumentType: 'etf' | 'stock' | 'bond';
  ticker: string;
  totalQty: string;
  avgPrice: string;
  isin: string;
  name: string;
  exchange: string;
  ter: string;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function msToDate(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
function mapCalendarFieldToFrequency(calendarField?: number | null): RecurringFrequency {
  if (calendarField === 1) return 'yearly';
  if (calendarField === 2) return 'monthly';
  return 'weekly';
}
function normalizeLooseText(value?: string | null): string {
  return (value || '').trim().toLocaleLowerCase();
}
function queryAll<T>(db: any, sql: string): T[] {
  const stmt = db.prepare(sql);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}
function isInvestmentName(name: string): boolean { return /investiment/i.test(name); }
function formatCurrency(amount: number, currency: string = 'EUR'): string {
  return amount.toLocaleString('it-IT', { style: 'currency', currency });
}

// ── TickerCard sub-component ──────────────────────────────────────────────────

interface TickerCardProps {
  id: string;
  contoName: string;
  // header info (mode A)
  date?: string;
  amount?: number;
  // header info (mode B)
  totalAmount?: number;
  transferCount?: number;
  // form values
  instrumentType: 'etf' | 'stock' | 'bond';
  ticker: string;
  quantity: string;
  price: string;
  commission?: string;
  qtyLabel: string;
  priceLabel: string;
  commissionLabel?: string;
  showValidation?: boolean;
  onRemove?: () => void;
  onChange: (id: string, updates: Partial<{ instrumentType: 'etf' | 'stock' | 'bond'; ticker: string; quantity: string; price: string; commission: string; isin: string; name: string; exchange: string; ter: string }>) => void;
}

function TickerCard({
  id, contoName, date, amount, totalAmount, transferCount,
  instrumentType, ticker, quantity, price, commission = '', qtyLabel, priceLabel, commissionLabel = 'Commissioni', showValidation, onRemove,
  onChange,
}: TickerCardProps) {
  const { t } = useTranslation();
  const [ucitsCache, setUcitsCache] = useState<any[]>([]);
  const [symbolOptions, setSymbolOptions] = useState<any[]>([]);
  const [symbolLoading, setSymbolLoading] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [symbolSearchCompleted, setSymbolSearchCompleted] = useState(false);
  const ucitsLoadedRef = useRef(false);
  const bondCacheLoadedRef = useRef(false);
  const skipNextSearch = useRef(false);
  const [bondCache, setBondCache] = useState<any[]>([]);
  const [selectedInfo, setSelectedInfo] = useState<{ name: string; exchange?: string; currency?: string } | null>(null);
  const [bondLookupLoading, setBondLookupLoading] = useState(false);
  const [bondLookupError, setBondLookupError] = useState(false);

  // Load UCITS cache for ETF (sessionStorage → API) — same approach as TransactionForm
  useEffect(() => {
    if (instrumentType !== 'etf' || ucitsLoadedRef.current || ucitsCache.length > 0) return;
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

  // Load bond cache (sessionStorage → API)
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

  // Symbol search with debounce
  useEffect(() => {
    if (skipNextSearch.current) { skipNextSearch.current = false; return; }
    if (!ticker || ticker.length < 2) {
      setSymbolOptions([]); setSymbolSearchCompleted(false); setSymbolSearchOpen(false); return;
    }
    // Bond: search local cache
    if (instrumentType === 'bond') {
      if (bondCache.length === 0) { setSymbolLoading(false); return; }
      const q = ticker.toUpperCase();
      const isIsin = /^[A-Z]{2}[A-Z0-9]{0,10}$/.test(q);
      const ql = ticker.toLowerCase();
      const filtered = bondCache.filter(b => {
        const isin = (b.isin || '').toUpperCase();
        const name = (b.name || '').toLowerCase();
        const issuer = (b.issuer || '').toLowerCase();
        return isIsin ? isin.startsWith(q) : (name.includes(ql) || issuer.includes(ql));
      }).slice(0, 20);
      setSymbolOptions(filtered);
      setSymbolSearchOpen(filtered.length > 0);
      setSymbolLoading(false);
      setSymbolSearchCompleted(true);
      return;
    }
    // ETF: wait for cache
    if (instrumentType === 'etf' && ucitsCache.length === 0) return;

    setSymbolSearchCompleted(false);
    const controller = new AbortController();
    const run = async () => {
      setSymbolLoading(true);
      if (instrumentType === 'etf') {
        await new Promise(r => setTimeout(r, 100));
        if (controller.signal.aborted) return;
        const q = ticker.toUpperCase();
        const isIsin = /^[A-Z]{2}[A-Z0-9]{10}$/.test(q);
        const filtered = ucitsCache.filter(item => {
          const sym = (item.symbol || '').toUpperCase();
          const isin = (item.isin || '').toUpperCase();
          return sym.startsWith(q) || (isIsin && isin === q);
        }).slice(0, 25);
        if (!controller.signal.aborted) {
          setSymbolOptions(filtered);
          setSymbolSearchOpen(true);
          setSymbolLoading(false);
          setSymbolSearchCompleted(true);
        }
      } else {
        try {
          const res = await fetch(
            `${PF_BACKEND_URL}/symbols/search?q=${encodeURIComponent(ticker)}&instrument_type=stock`,
            { signal: controller.signal }
          );
          if (res.ok) { const data = await res.json(); setSymbolOptions(data.results || []); setSymbolSearchOpen(true); }
        } catch (err: any) {
          if (err.name !== 'AbortError') console.error(err);
        } finally {
          if (!controller.signal.aborted) { setSymbolLoading(false); setSymbolSearchCompleted(true); }
        }
      }
    };
    const timer = setTimeout(run, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [ticker, instrumentType, ucitsCache, bondCache]);

  const selectSymbol = (item: any) => {
    skipNextSearch.current = true;
    if (instrumentType === 'bond') {
      const symName = item.name || item.issuer || '';
      onChange(id, { ticker: item.isin || '', isin: item.isin || '', name: symName, exchange: 'MOT/EuroMOT', ter: '' });
      setSelectedInfo({ name: symName, exchange: 'MOT/EuroMOT', currency: item.currency || 'EUR' });
    } else {
      const symName = item.name || '';
      const symExchange = item.exchange || '';
      const symIsin = item.isin || '';
      const symTer = item.ter != null ? String(item.ter) : '';
      onChange(id, { ticker: (item.symbol || '').toUpperCase(), isin: symIsin, name: symName, exchange: symExchange, ter: symTer });
      setSelectedInfo({ name: symName, exchange: symExchange, currency: item.currency || '' });
    }
    setSymbolOptions([]); setSymbolSearchOpen(false);
  };

  const handleBondLookup = async () => {
    const isin = ticker.toUpperCase().trim();
    if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)) return;
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
      skipNextSearch.current = true;
      onChange(id, { ticker: isin, isin, name: metadata?.name || metadata?.issuer || isin, exchange: 'MOT/EuroMOT', ter: '' });
      setSelectedInfo({ name: metadata?.name || metadata?.issuer || isin, exchange: 'MOT/EuroMOT', currency: metadata?.currency || 'EUR' });
      setSymbolOptions([]); setSymbolSearchOpen(false);
      setSymbolSearchCompleted(true);
    } catch { setBondLookupError(true); }
    finally { setBondLookupLoading(false); }
  };

  useEffect(() => {
    if (!ticker.trim()) {
      setSelectedInfo(null);
      setBondLookupError(false);
      setSymbolOptions([]);
      setSymbolSearchOpen(false);
      setSymbolSearchCompleted(false);
    }
  }, [ticker]);

  const autoPriceFromQuantity = (nextQuantity: string, nextCommission: string = commission) => {
    if (amount == null) return;
    const qty = parseFloat(nextQuantity);
    const comm = parseFloat(nextCommission || '0');
    if (!Number.isFinite(qty) || qty <= 0) return;
    const computed = (amount - (Number.isFinite(comm) ? comm : 0)) / qty;
    if (Number.isFinite(computed) && computed > 0) {
      onChange(id, { quantity: nextQuantity, price: computed.toFixed(4), commission: nextCommission });
      return true;
    }
    return false;
  };

  const autoQuantityFromPrice = (nextPrice: string, nextCommission: string = commission) => {
    if (amount == null) return;
    const px = parseFloat(nextPrice);
    const comm = parseFloat(nextCommission || '0');
    if (!Number.isFinite(px) || px <= 0) return;
    const computed = (amount - (Number.isFinite(comm) ? comm : 0)) / px;
    if (Number.isFinite(computed) && computed > 0) {
      onChange(id, { quantity: computed.toFixed(6), price: nextPrice, commission: nextCommission });
      return true;
    }
    return false;
  };

  const missing = showValidation && (!ticker.trim() || !quantity.trim() || !price.trim());

  return (
    <div className={`rounded-xl border p-3 space-y-3 ${missing ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {contoName ? (
            <>
              <span className="text-base">📈</span>
              <div>
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{contoName}</div>
                {date && <div className="text-xs text-gray-400">{date}</div>}
                {transferCount != null && (
                  <div className="text-xs text-primary-500 dark:text-primary-400">
                    {transferCount} acquist{transferCount === 1 ? 'o' : 'i'}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div>
              {date && <div className="text-xs text-gray-400">{date}</div>}
              {transferCount != null && (
                <div className="text-xs text-primary-500 dark:text-primary-400">
                  {transferCount} acquist{transferCount === 1 ? 'o' : 'i'}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <div className="text-right">
            {amount != null && (
              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                {amount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}
              </div>
            )}
            {totalAmount != null && (
              <>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">
                  {totalAmount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}
                </div>
                <div className="text-xs text-gray-400">totale investito</div>
              </>
            )}
          </div>
          {onRemove && (
            <button type="button" onClick={onRemove} className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0" aria-label="Rimuovi">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* ETF / Stock / Bond toggle */}
      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
        {(['etf', 'stock', 'bond'] as const).map(typ => (
          <button
            key={typ}
            type="button"
            onClick={() => { onChange(id, { instrumentType: typ, ticker: '' }); setSymbolOptions([]); setSymbolSearchOpen(false); setSymbolSearchCompleted(false); setSelectedInfo(null); setBondLookupError(false); }}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${instrumentType === typ ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
          >
            {typ === 'etf' ? 'ETF' : typ === 'stock' ? 'Stock' : 'Bond'}
          </button>
        ))}
      </div>

      {/* Ticker search */}
      <div className="relative">
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
          {instrumentType === 'etf' ? t('transactions.tickerOrIsin') : t('transactions.tickerOrName')}
        </label>
        <div className="relative">
          <input
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent uppercase font-mono"
            placeholder={instrumentType === 'etf' ? 'VWCE, SWDA, IE00...' : instrumentType === 'bond' ? 'BTP, XS12...' : 'AAPL, MSFT...'}
            value={ticker}
            onChange={e => { onChange(id, { ticker: e.target.value.toUpperCase() }); setSelectedInfo(null); setBondLookupError(false); }}
            onFocus={() => { if (symbolOptions.length > 0) setSymbolSearchOpen(true); }}
            onBlur={() => setTimeout(() => setSymbolSearchOpen(false), 150)}
          />
          {symbolLoading && (
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
        </div>
        {symbolSearchOpen && ticker.length >= 2 && !symbolLoading && symbolSearchCompleted && symbolOptions.length > 0 && (
          <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden max-h-44 overflow-y-auto">
            {symbolOptions.map((item: any, i: number) => (
              <button
                key={i}
                type="button"
                onMouseDown={() => selectSymbol(item)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
              >
                {instrumentType === 'bond' ? (
                  <>
                    <div className="font-mono font-bold text-xs text-gray-900 dark:text-gray-100">{item.isin}</div>
                    {(item.name || item.issuer) && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.name || item.issuer}</div>}
                    <div className="flex gap-2 text-xs text-gray-400 mt-0.5">
                      {item.maturity && <span>Sc. {item.maturity}</span>}
                      {item.coupon != null && <span>{item.coupon}%</span>}
                      {item.currency && <span className="text-blue-500">{item.currency}</span>}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-gray-900 dark:text-gray-100">{item.symbol}</span>
                      {item.exchange && <span className="text-xs text-gray-400">{item.exchange}</span>}
                      {item.currency && <span className="text-xs text-blue-500">{item.currency}</span>}
                    </div>
                    {item.name && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.name}</div>}
                  </>
                )}
              </button>
            ))}
          </div>
        )}
        {instrumentType === 'bond' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(ticker.trim().toUpperCase()) && symbolSearchCompleted && symbolOptions.length === 0 && !selectedInfo && (
          <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              type="button"
              onMouseDown={handleBondLookup}
              disabled={bondLookupLoading}
              className="w-full px-3 py-2 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left disabled:opacity-50"
            >
              {bondLookupLoading ? 'Ricerca...' : `Cerca obbligazione: ${ticker}`}
            </button>
            {bondLookupError && <div className="px-3 py-1.5 text-xs text-red-500">Non trovato</div>}
          </div>
        )}
      </div>

      {selectedInfo?.name && (
        <div className="px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg text-xs flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{selectedInfo.name}</span>
          {selectedInfo.exchange && <span className="text-gray-400">{selectedInfo.exchange}</span>}
          {selectedInfo.currency && <span className="text-blue-500">{selectedInfo.currency}</span>}
        </div>
      )}

      {/* Qty + Price + Commission */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{qtyLabel}</label>
          <input
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="10"
            type="number" min="0" step="any"
            value={quantity}
            onChange={e => {
              const nextQuantity = e.target.value;
              if (!autoPriceFromQuantity(nextQuantity)) {
                onChange(id, { quantity: nextQuantity });
              }
            }}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{priceLabel}</label>
          <input
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="100.00"
            type="number" min="0" step="any"
            value={price}
            onChange={e => {
              const nextPrice = e.target.value;
              if (!autoQuantityFromPrice(nextPrice)) {
                onChange(id, { price: nextPrice });
              }
            }}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{commissionLabel}</label>
          <input
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="0.00"
            type="number" min="0" step="any"
            value={commission}
            onChange={e => {
              const nextCommission = e.target.value;
              if (quantity.trim() && autoPriceFromQuantity(quantity, nextCommission)) return;
              if (price.trim() && autoQuantityFromPrice(price, nextCommission)) return;
              onChange(id, { commission: nextCommission });
            }}
          />
        </div>
      </div>

      {missing && (
        <p className="text-xs text-red-500 dark:text-red-400">Compila tutti i campi per creare l'ordine</p>
      )}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────────

interface Props { onClose: () => void; onDirtyChange?: (dirty: boolean) => void; }
type Step = 'upload' | 'options' | 'categories' | 'recurring' | 'inv_details' | 'importing' | 'done';
type InvMode = 'orders' | 'positions';
interface SkippedImportRecord {
  movimentoId: number;
  date: string;
  amount: number;
  conto?: string;
  contoPrelievo?: string;
  reason: string;
}
interface AccountBalanceCheck {
  contoId: number;
  contoName: string;
  expected: number;
  actual: number;
  diff: number;
}

export default function KakeboImport({ onClose, onDirtyChange }: Props) {
  const { t } = useTranslation();
  const { accounts, categories, transactions, transfers, portfolios, refreshAll } = useData();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedDB | null>(null);
  const [invContoIds, setInvContoIds] = useState<Set<number>>(new Set());

  const [invMode, setInvMode] = useState<InvMode>('orders');
  const [invDetails, setInvDetails] = useState<InvDetail[]>([]);    // mode A
  const [invPositions, setInvPositions] = useState<InvPosition[]>([]); // mode B
  const [positionDrafts, setPositionDrafts] = useState<Record<number, InvPosition>>({});
  const [editingPositionIds, setEditingPositionIds] = useState<Record<number, string | null>>({});
  const [recurringDrafts, setRecurringDrafts] = useState<RecurringDraft[]>([]);
  const [categoryView, setCategoryView] = useState<'expense' | 'income'>('expense');
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<number>>(new Set());
  const [validated, setValidated] = useState(false);

  const markDirty = () => { onDirtyChange?.(true); };
  const clearDirty = () => { onDirtyChange?.(false); };

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    accounts: number; transactions: number; investments: number; transfers: number; orders: number; recurring: number; skipped: number; skippedDetails: SkippedImportRecord[]; balanceChecks: AccountBalanceCheck[];
  } | null>(null);
  const [progress, setProgress] = useState('');

  const formatImportError = (err: any) => {
    const raw = String(err?.message || err || '').trim();
    const details = String(err?.details || '').trim();

    if (/not authenticated/i.test(raw)) {
      return 'Sessione scaduta. Ricarica la pagina ed effettua di nuovo l’accesso.';
    }
    if (/forbidden/i.test(raw)) {
      return 'Non hai i permessi per importare nel profilo attivo.';
    }
    if (/profile not found/i.test(raw)) {
      return 'Profilo attivo non trovato. Ricarica la pagina e riprova.';
    }
    if (/missing .* mapping/i.test(raw)) {
      return `Import interrotto per dati interni incoerenti.${details ? ` ${details}` : ''}`;
    }
    if (raw) {
      return `Import non completato. ${raw}`;
    }
    return 'Import non completato per un errore imprevisto.';
  };

  const isBonusInvestmentMovement = (movement: KMovimento, categories: KCategoria[]): boolean => {
    if (movement.tipo !== 1 || movement.contoPrelievoId != null || !invContoIds.has(movement.contoId)) return false;
    const categoryById = new Map(categories.map(c => [c.id, c]));
    const category = movement.categoriaId != null ? categoryById.get(movement.categoriaId) : undefined;
    const subcategory = movement.sottocategoriaId != null ? categoryById.get(movement.sottocategoriaId) : undefined;
    const haystack = [
      normalizeLooseText(category?.nome),
      normalizeLooseText(subcategory?.nome),
      normalizeLooseText(movement.note),
    ].join(' ');
    return /\b(saveback|bonus)\b/.test(haystack);
  };

  // ── step 1: parse file ──────────────────────────────────────────────────────

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
      const buf = await file.arrayBuffer();
      const db = new SQL.Database(new Uint8Array(buf));

      const conti = queryAll<any>(db, 'SELECT id, nome, tipo, variazioneSaldo1 FROM Conto').map(r => ({
        id: r.id as number, nome: (r.nome as string) || '', tipo: r.tipo as number,
        variazioneSaldo1: (r.variazioneSaldo1 as number) || 0,
      }));
      const categorie = queryAll<any>(db, 'SELECT id, padreId, tipoMovimento, nome FROM Categoria').map(r => ({
        id: r.id as number, padreId: r.padreId as number | null,
        tipoMovimento: r.tipoMovimento as number, nome: (r.nome as string) || '',
      }));
      const movimenti = queryAll<any>(
        db, 'SELECT id, contoId, categoriaId, sottocategoriaId, dataOperazione, note, tipo, contoPrelievoId, importo1, numeroRipetizioni, calendarField FROM Movimento'
      ).map(r => ({
        id: r.id as number, contoId: r.contoId as number,
        categoriaId: r.categoriaId as number | null, sottocategoriaId: r.sottocategoriaId as number | null,
        dataOperazione: r.dataOperazione as number, note: r.note as string | null,
        tipo: r.tipo as number, contoPrelievoId: r.contoPrelievoId as number | null,
        importo1: r.importo1 as number,
        numeroRipetizioni: r.numeroRipetizioni as number | null,
        calendarField: r.calendarField as number | null,
      }));

      db.close();
      setParsed({ conti, categorie, movimenti });
      setInvContoIds(new Set(conti.filter(c => c.tipo === 1 || isInvestmentName(c.nome)).map(c => c.id)));
      setStep('options');
    } catch (e: any) {
      if (/failed to (fetch|load|import)/i.test(e?.message || '')) { window.location.reload(); return; }
      setError(e.message || String(e));
    }
  };

  const handleGoToRecurring = () => {
    if (!parsed) return;

    const kCatById = new Map(parsed.categorie.map(c => [c.id, c]));
    const catResolved: Record<number, { catName: string; subName?: string }> = {};
    for (const c of parsed.categorie) {
      if (c.padreId == null) {
        catResolved[c.id] = { catName: c.nome.trim() };
      } else {
        const parent = kCatById.get(c.padreId);
        catResolved[c.id] = { catName: parent ? parent.nome.trim() : c.nome.trim(), subName: c.nome.trim() };
      }
    }
    const contoNameById = new Map(parsed.conti.map(c => [c.id, c.nome.trim()]));

    const drafts: RecurringDraft[] = parsed.movimenti
      .filter(m => (m.numeroRipetizioni ?? 0) > 0)
      .sort((a, b) => a.dataOperazione - b.dataOperazione)
      .flatMap((m): RecurringDraft[] => {
        const startDate = msToDate(m.dataOperazione);
        const frequency = mapCalendarFieldToFrequency(m.calendarField);
        const amount = String(Math.abs(m.importo1));
        const description = (m.note || '').trim();

        if (m.tipo === -1 && invContoIds.has(m.contoId) && m.contoPrelievoId != null && !invContoIds.has(m.contoPrelievoId)) {
          return [{
            movimentoId: m.id,
            enabled: true,
            type: 'investment',
            sourceContoId: m.contoPrelievoId,
            portfolioContoId: m.contoId,
            accountName: contoNameById.get(m.contoPrelievoId) || '—',
            portfolioName: contoNameById.get(m.contoId) || '—',
            category: contoNameById.get(m.contoId) || 'Investimenti',
            subcategory: null,
            amount,
            description,
            startDate,
            frequency,
          }];
        }

        if (m.tipo !== -1 && !invContoIds.has(m.contoId)) {
          const catId = m.sottocategoriaId ?? m.categoriaId;
          const resolved = catId != null ? catResolved[catId] : undefined;
          return [{
            movimentoId: m.id,
            enabled: true,
            type: m.tipo === 1 ? 'income' : 'expense',
            sourceContoId: m.contoId,
            accountName: contoNameById.get(m.contoId) || '—',
            category: resolved?.catName || 'Altro',
            subcategory: resolved?.subName || null,
            amount,
            description,
            startDate,
            frequency,
          }];
        }

        return [];
      });

    setRecurringDrafts(drafts);
    setStep('recurring');
  };

  const updateRecurringDraft = (movimentoId: number, updates: Partial<RecurringDraft>) => {
    markDirty();
    setRecurringDrafts(prev => prev.map(d => d.movimentoId === movimentoId ? { ...d, ...updates } : d));
  };

  // ── step 3→4: build inv details/positions ───────────────────────────────────

  const handleGoToInvDetails = () => {
    if (!parsed) return;
    const invTransfers = parsed.movimenti.filter(m => m.tipo === -1 && invContoIds.has(m.contoId));
    const bonusMovements = parsed.movimenti.filter(m => isBonusInvestmentMovement(m, parsed.categorie));
    if (invTransfers.length === 0 && bonusMovements.length === 0) { handleImport(); return; }

    // Build mode A: one InvDetail per transfer or bonus investment movement, sorted by date
    const details: InvDetail[] = [...invTransfers, ...bonusMovements]
      .sort((a, b) => a.dataOperazione - b.dataOperazione)
      .map(m => ({
        movimentoId: m.id,
        sourceKind: m.tipo === -1 ? 'transfer' : 'bonus',
        date: msToDate(m.dataOperazione),
        amount: Math.abs(m.importo1),
        description: m.note || null,
        destContoId: m.contoId,
        instrumentType: 'etf',
        ticker: '',
        quantity: '',
        price: '',
        commission: '',
        isin: '',
        name: '',
        exchange: '',
        ter: '',
      }));
    setInvDetails(details);

    // Build mode B: one InvPosition per inv conto (user can add more later)
    const posMap = new Map<number, { totalAmount: number; transferCount: number; lastDate: string }>();
    for (const m of invTransfers) {
      const date = msToDate(m.dataOperazione);
      if (!posMap.has(m.contoId)) {
        posMap.set(m.contoId, { totalAmount: Math.abs(m.importo1), transferCount: 1, lastDate: date });
      } else {
        const p = posMap.get(m.contoId)!;
        p.totalAmount += Math.abs(m.importo1);
        p.transferCount++;
        if (date > p.lastDate) p.lastDate = date;
      }
    }
    setInvPositions([]);
    setPositionDrafts(Object.fromEntries(Array.from(posMap.entries()).map(([contoId, info]) => [contoId, {
      id: `draft-${contoId}`,
      contoId,
      ...info,
      instrumentType: 'etf' as const,
      ticker: '',
      totalQty: '',
      avgPrice: '',
      isin: '',
      name: '',
      exchange: '',
      ter: '',
    }])));
    setEditingPositionIds(Object.fromEntries(Array.from(posMap.keys()).map(contoId => [contoId, null])));
    setStep('inv_details');
  };

  const updateDetail = (movimentoId: number, updates: Partial<Pick<InvDetail, 'instrumentType' | 'ticker' | 'quantity' | 'price' | 'commission' | 'isin' | 'name' | 'exchange' | 'ter'>>) => {
    markDirty();
    setInvDetails(prev => prev.map(d => d.movimentoId === movimentoId ? { ...d, ...updates } : d));
  };

  const updatePositionDraft = (contoId: number, updates: Partial<Pick<InvPosition, 'instrumentType' | 'ticker' | 'totalQty' | 'avgPrice' | 'isin' | 'name' | 'exchange' | 'ter'>>) => {
    markDirty();
    setPositionDrafts(prev => prev[contoId] ? ({ ...prev, [contoId]: { ...prev[contoId], ...updates } }) : prev);
  };

  const resetPositionDraft = (contoId: number) => {
    const ref = positionDrafts[contoId] ?? invPositions.find(p => p.contoId === contoId);
    if (!ref) return;
    setPositionDrafts(prev => ({
      ...prev,
      [contoId]: {
        id: `draft-${contoId}`,
        contoId,
        totalAmount: ref.totalAmount,
        transferCount: ref.transferCount,
        lastDate: ref.lastDate,
        instrumentType: 'etf',
        ticker: '',
        totalQty: '',
        avgPrice: '',
        isin: '',
        name: '',
        exchange: '',
        ter: '',
      },
    }));
    setEditingPositionIds(prev => ({ ...prev, [contoId]: null }));
  };

  const addOrUpdatePosition = (contoId: number) => {
    const draft = positionDrafts[contoId];
    if (!draft || !draft.ticker.trim() || !draft.totalQty.trim() || !draft.avgPrice.trim()) return;
    markDirty();
    const editingId = editingPositionIds[contoId];
    const normalizedDraft = { ...draft, id: editingId ?? `${contoId}-${Date.now()}` };
    setInvPositions(prev => editingId
      ? prev.map(p => p.id === editingId ? normalizedDraft : p)
      : [...prev, normalizedDraft]);
    resetPositionDraft(contoId);
  };

  const editPosition = (position: InvPosition) => {
    markDirty();
    setPositionDrafts(prev => ({ ...prev, [position.contoId]: { ...position } }));
    setEditingPositionIds(prev => ({ ...prev, [position.contoId]: position.id }));
  };

  const removePosition = (posId: string) => {
    markDirty();
    const target = invPositions.find(p => p.id === posId);
    setInvPositions(prev => prev.filter(p => p.id !== posId));
    if (target && editingPositionIds[target.contoId] === posId) {
      resetPositionDraft(target.contoId);
    }
  };

  // ── step 4: import ──────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!parsed) return;

    // Mode A validation: all fields required
    if (invMode === 'orders' && invDetails.length > 0) {
      const firstIncomplete = invDetails.find(d => !d.ticker.trim() || !d.quantity.trim() || !d.price.trim());
      if (firstIncomplete) {
        setValidated(true);
        setError('Compila tutti i campi per ogni operazione');
        setTimeout(() => {
          document.getElementById(`card-${firstIncomplete.movimentoId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
        return;
      }
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const userId = user.id;
      const profileId = apiService.getActiveProfileId();
      const existingPortfolioIds = (await supabase.from('portfolios').select('id').eq('profile_id', profileId)).data?.map((row: any) => row.id) || [];
      const { count: existingOrdersCount, error: ordersCountErr } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .in('portfolio_id', existingPortfolioIds.length > 0 ? existingPortfolioIds : [-1]);
      if (ordersCountErr) throw ordersCountErr;
      const { count: existingRecurringCount, error: recurringCountErr } = await supabase
        .from('recurring_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', profileId);
      if (recurringCountErr) throw recurringCountErr;

      const confirmed = await confirmDialog(
        [
          'Stai per sovrascrivere il profilo attivo.',
          '',
          'Verranno eliminati:',
          `- ${accounts.length} conti`,
          `- ${categories.length} categorie`,
          `- ${portfolios.length} portafogli`,
          `- ${transactions.length} transazioni`,
          `- ${transfers.length} trasferimenti`,
          `- ${existingRecurringCount ?? 0} ricorrenze`,
          `- ${existingOrdersCount ?? 0} ordini`,
          '',
          'Vuoi continuare?'
        ].join('\n'),
        {
          title: 'Conferma import',
          confirmText: 'Importa',
          cancelText: 'Annulla',
          isDestructive: true,
          noBottomOffset: true,
        }
      );
      if (!confirmed) return;

      setValidated(false);
      setStep('importing');
      setError(null);
      const duplicateNormalizedNames = (values: string[]) => {
        const seen = new Set<string>();
        const duplicates = new Set<string>();
        for (const value of values.map(v => v.trim()).filter(Boolean)) {
          const normalized = value.toLocaleLowerCase();
          if (seen.has(normalized)) duplicates.add(value);
          seen.add(normalized);
        }
        return [...duplicates];
      };

      const investmentConti = parsed.conti.filter(c => invContoIds.has(c.id));
      const regularConti = parsed.conti.filter(c => !invContoIds.has(c.id));

      const duplicatePortfolioNames = duplicateNormalizedNames(investmentConti.map(c => c.nome));
      if (duplicatePortfolioNames.length > 0) {
        throw new Error(`Portafogli duplicati nel file Kakebo: ${duplicatePortfolioNames.join(', ')}`);
      }
      const duplicateAccountNames = duplicateNormalizedNames(regularConti.map(c => c.nome));
      if (duplicateAccountNames.length > 0) {
        throw new Error(`Conti duplicati nel file Kakebo: ${duplicateAccountNames.join(', ')}`);
      }

      const invContoToCategoryName: Record<number, string> = {};
      for (const conto of investmentConti) invContoToCategoryName[conto.id] = conto.nome.trim();
      const contoNameById: Record<number, string> = {};
      for (const conto of parsed.conti) contoNameById[conto.id] = conto.nome.trim();

      const kCatById: Record<number, KCategoria> = {};
      for (const c of parsed.categorie) kCatById[c.id] = c;
      const catResolved: Record<number, { catName: string; subName?: string }> = {};
      for (const c of parsed.categorie) {
        if (c.padreId == null) {
          catResolved[c.id] = { catName: c.nome.trim() };
        } else {
          const parent = kCatById[c.padreId];
          catResolved[c.id] = { catName: parent ? parent.nome.trim() : c.nome.trim(), subName: c.nome.trim() };
        }
      }

      const getCatType = (catId: number): 'expense' | 'income' => {
        const cat = kCatById[catId];
        if (!cat) return 'expense';
        return cat.tipoMovimento === 1 ? 'income' : 'expense';
      };

      const categoryDefs = new Map<string, { name: string; type: 'expense' | 'income'; icon: string; subNames: Set<string> }>();
      for (const m of parsed.movimenti) {
        if (m.tipo === -1) continue;
        const catId = m.sottocategoriaId ?? m.categoriaId;
        if (catId == null || !catResolved[catId]) continue;
        const { catName, subName } = catResolved[catId];
        const type = getCatType(catId);
        const key = `${catName.toLocaleLowerCase()}|${type}`;
        const existing = categoryDefs.get(key);
        if (existing) {
          if (subName) existing.subNames.add(subName);
        } else {
          categoryDefs.set(key, {
            name: catName,
            type,
            icon: type === 'income' ? '💰' : '💸',
            subNames: new Set(subName ? [subName] : []),
          });
        }
      }

      const duplicateCategoryNames = duplicateNormalizedNames([...categoryDefs.values()].map(def => def.name));
      if (duplicateCategoryNames.length > 0) {
        throw new Error(`Categorie duplicate nel file Kakebo: ${duplicateCategoryNames.join(', ')}`);
      }

      // Build all rows before touching existing profile data.
      const transactionSources: any[] = [];
      const transferRows: any[] = [];
      let skipped = 0;
      const skippedDetails: SkippedImportRecord[] = [];
      const recordSkipped = (movimento: KMovimento, reason: string) => {
        skipped += 1;
        skippedDetails.push({
          movimentoId: movimento.id,
          date: msToDate(movimento.dataOperazione),
          amount: Math.abs(movimento.importo1),
          conto: contoNameById[movimento.contoId],
          contoPrelievo: movimento.contoPrelievoId != null ? contoNameById[movimento.contoPrelievoId] : undefined,
          reason,
        });
      };

      // Map movimentoId → InvDetail (mode A)
      const movToDetail = new Map<number, InvDetail>();
      if (invMode === 'orders') for (const d of invDetails) movToDetail.set(d.movimentoId, d);

      for (const m of parsed.movimenti) {
        const date = msToDate(m.dataOperazione);
        const amount = Math.abs(m.importo1);
        const description = m.note || null;

        if (m.tipo === -1) {
          if (invContoIds.has(m.contoId)) {
            // Regular → Investment: deduct from source regular account
            if (m.contoPrelievoId == null || invContoIds.has(m.contoPrelievoId)) {
              recordSkipped(m, 'Investment transfer without a valid source account');
              continue;
            }
            const catName = invContoToCategoryName[m.contoId] ?? 'Investimenti';
          transactionSources.push({
            type: 'investment',
            sourceContoId: m.contoPrelievoId,
            category: catName,
            subcategory: null,
            amount,
            description,
            date,
            _movId: m.id,
            _recurringKey: (m.numeroRipetizioni ?? 0) > 0 ? `mov:${m.id}` : null,
          });
          } else {
            const fromIsInv = m.contoPrelievoId != null && invContoIds.has(m.contoPrelievoId);
            if (fromIsInv) {
              // Investment → Regular: credit the destination regular account
              if (invContoIds.has(m.contoId)) {
                recordSkipped(m, 'Investment exit points to another investment account');
                continue;
              }
              const catName = invContoToCategoryName[m.contoPrelievoId!] ?? 'Investimenti';
              transactionSources.push({
                type: 'income',
                sourceContoId: m.contoId,
                category: catName,
                subcategory: null,
                amount,
                description,
                date,
              });
            } else {
              if (m.contoPrelievoId == null || invContoIds.has(m.contoId) || invContoIds.has(m.contoPrelievoId)) {
                recordSkipped(m, 'Transfer could not be mapped to two regular accounts');
                continue;
              }
              transferRows.push({
                user_id: userId,
                profile_id: profileId,
                from_source_conto_id: m.contoPrelievoId,
                to_source_conto_id: m.contoId,
                amount,
                description,
                date,
              });
            }
          }
        } else {
          const catId = m.sottocategoriaId ?? m.categoriaId;
          let catName = 'Altro'; let subName: string | undefined;
          if (catId != null && catResolved[catId]) { catName = catResolved[catId].catName; subName = catResolved[catId].subName; }
          if (invContoIds.has(m.contoId)) {
            if (isBonusInvestmentMovement(m, parsed.categorie)) {
              continue;
            }
            recordSkipped(m, 'Investment account movement without linked cash transfer (e.g. dividend/interest)');
            continue;
          }
          const type: 'expense' | 'income' = m.tipo === 1 ? 'income' : 'expense';
          transactionSources.push({
            type,
            sourceContoId: m.contoId,
            category: catName,
            subcategory: subName || null,
            amount,
            description,
            date,
            _movId: m.id,
            _recurringKey: (m.numeroRipetizioni ?? 0) > 0 ? `mov:${m.id}` : null,
          });
        }
      }
      // Compute imported net effect per regular account from records that will
      // actually exist in Trackr.
      const importedNetPerConto: Record<number, number> = {};
      for (const row of transactionSources) {
        if (invContoIds.has(row.sourceContoId)) continue;
        const delta = row.type === 'income' ? row.amount : -row.amount;
        importedNetPerConto[row.sourceContoId] = (importedNetPerConto[row.sourceContoId] ?? 0) + delta;
      }
      for (const row of transferRows) {
        importedNetPerConto[row.from_source_conto_id] = (importedNetPerConto[row.from_source_conto_id] ?? 0) - row.amount;
        importedNetPerConto[row.to_source_conto_id] = (importedNetPerConto[row.to_source_conto_id] ?? 0) + row.amount;
      }
      const sourceNetPerConto: Record<number, number> = {};
      for (const m of parsed.movimenti) {
        const amount = Math.abs(m.importo1);
        if (m.tipo === -1) {
          if (invContoIds.has(m.contoId)) {
            if (m.contoPrelievoId != null && !invContoIds.has(m.contoPrelievoId)) {
              sourceNetPerConto[m.contoPrelievoId] = (sourceNetPerConto[m.contoPrelievoId] ?? 0) - amount;
            }
          } else {
            const fromIsInv = m.contoPrelievoId != null && invContoIds.has(m.contoPrelievoId);
            if (fromIsInv) {
              sourceNetPerConto[m.contoId] = (sourceNetPerConto[m.contoId] ?? 0) + amount;
            } else if (m.contoPrelievoId != null && !invContoIds.has(m.contoPrelievoId)) {
              sourceNetPerConto[m.contoId] = (sourceNetPerConto[m.contoId] ?? 0) + amount;
              sourceNetPerConto[m.contoPrelievoId] = (sourceNetPerConto[m.contoPrelievoId] ?? 0) - amount;
            }
          }
        } else if (!invContoIds.has(m.contoId)) {
          sourceNetPerConto[m.contoId] = (sourceNetPerConto[m.contoId] ?? 0) + m.importo1;
        }
      }

      setProgress(t('kakebo.resetData'));
      const transactionRows = transactionSources.map((row: any) => ({
        transaction_key: row._movId != null ? `mov:${row._movId}` : null,
        recurring_key: row._recurringKey ?? null,
        source_conto_id: row.sourceContoId,
        type: row.type,
        category: row.category,
        subcategory: row.subcategory || null,
        amount: row.amount,
        description: row.description,
        date: row.date,
        ticker: row.ticker || null,
        quantity: row.quantity || null,
        price: row.price || null,
      }));

      const balanceChecks: AccountBalanceCheck[] = regularConti.map((conto) => {
        const initialBalance = conto.variazioneSaldo1;
        let reconstructed = initialBalance;

        for (const tx of transactionRows) {
          if (tx.source_conto_id !== conto.id) continue;
          if (tx.type === 'income') reconstructed += tx.amount;
          else if (tx.type === 'expense' || tx.type === 'investment') reconstructed -= tx.amount;
        }

        for (const tr of transferRows) {
          if (tr.from_source_conto_id === conto.id) reconstructed -= tr.amount;
          if (tr.to_source_conto_id === conto.id) reconstructed += tr.amount;
        }

        const expected = Number((initialBalance + (sourceNetPerConto[conto.id] ?? 0)).toFixed(2));
        const roundedActual = Number(reconstructed.toFixed(2));
        return {
          contoId: conto.id,
          contoName: conto.nome.trim(),
          expected,
          actual: roundedActual,
          diff: Number((roundedActual - expected).toFixed(2)),
        };
      });

      const orderRows: any[] = [];
      if (invMode === 'orders') {
        for (const m of parsed.movimenti) {
          const detail = movToDetail.get(m.id);
          if (!detail) continue;
          if (detail.sourceKind === 'transfer' && (m.tipo !== -1 || !invContoIds.has(m.contoId))) continue;
          if (detail.sourceKind === 'bonus' && !isBonusInvestmentMovement(m, parsed.categorie)) continue;
          if (!detail?.ticker.trim() || !detail.quantity.trim() || !detail.price.trim()) {
            recordSkipped(m, detail?.sourceKind === 'bonus'
              ? 'Bonus/saveback movement imported without order because ticker, quantity or price is missing'
              : 'Investment transaction imported without order because ticker, quantity or price is missing');
            continue;
          }
          orderRows.push({
            source_portfolio_conto_id: detail.destContoId,
            transaction_key: detail.sourceKind === 'transfer' ? `mov:${m.id}` : null,
            symbol: detail.ticker.trim().toUpperCase(),
            isin: detail.isin || null,
            name: detail.name || null,
            exchange: detail.exchange || null,
            currency: 'EUR',
            quantity: parseFloat(detail.quantity),
            price: parseFloat(detail.price),
            commission: parseFloat(detail.commission || '0') || 0,
            instrument_type: detail.instrumentType,
            order_type: 'buy',
            date: detail.date,
            ter: detail.ter || null,
          });
        }
      } else {
        for (const pos of invPositions) {
          if (!pos.ticker.trim() || !pos.totalQty.trim() || !pos.avgPrice.trim()) continue;
          orderRows.push({
            source_portfolio_conto_id: pos.contoId,
            transaction_key: null,
            symbol: pos.ticker.trim().toUpperCase(),
            isin: pos.isin || null,
            name: pos.name || null,
            exchange: pos.exchange || null,
            currency: 'EUR',
            quantity: parseFloat(pos.totalQty),
            price: parseFloat(pos.avgPrice),
            commission: 0,
            instrument_type: pos.instrumentType,
            order_type: 'buy',
            date: pos.lastDate,
            ter: pos.ter || null,
          });
        }
      }

      const recurringRows = recurringDrafts
        .filter(rule => rule.enabled && rule.amount.trim() && rule.startDate)
        .map((rule) => {
          const detail = movToDetail.get(rule.movimentoId);
          return {
            recurring_key: `mov:${rule.movimentoId}`,
            source_conto_id: rule.sourceContoId,
            source_portfolio_conto_id: rule.portfolioContoId ?? null,
            type: rule.type,
            category: rule.category,
            subcategory: rule.subcategory || null,
            amount: Number(rule.amount),
            description: rule.description.trim() || null,
            frequency: rule.frequency,
            start_date: rule.startDate,
            next_due_date: getNextDueDate(rule.startDate, rule.frequency),
            ticker: rule.type === 'investment' ? detail?.ticker?.trim().toUpperCase() || null : null,
            isin: rule.type === 'investment' ? detail?.isin?.trim() || null : null,
            instrument_name: rule.type === 'investment' ? detail?.name?.trim() || null : null,
            exchange: rule.type === 'investment' ? detail?.exchange?.trim() || null : null,
            instrument_type: rule.type === 'investment' ? detail?.instrumentType || null : null,
            order_type: rule.type === 'investment' ? 'buy' : null,
            currency: rule.type === 'investment' ? 'EUR' : null,
            quantity: rule.type === 'investment' && detail?.quantity ? Number(detail.quantity) : null,
            price: rule.type === 'investment' && detail?.price ? Number(detail.price) : null,
          };
        });

      const payload = {
        portfolios: investmentConti.map((conto) => ({
          source_conto_id: conto.id,
          name: conto.nome.trim(),
          history_mode: invMode === 'positions' ? 'positions_only' : 'full_orders',
          initial_capital: 0,
          reference_currency: 'EUR',
          risk_free_source: 'auto',
          market_benchmark: 'auto',
        })),
        accounts: regularConti.map((conto) => ({
          source_conto_id: conto.id,
          name: conto.nome.trim(),
          icon: '🏦',
          initial_balance: conto.variazioneSaldo1,
        })),
        categories: [...categoryDefs.values()].map((def) => ({
          key: `${def.name.toLocaleLowerCase()}|${def.type}`,
          name: def.name,
          type: def.type,
          icon: def.icon,
          subcategories: [...def.subNames],
        })),
        transactions: transactionRows,
        transfers: transferRows.map((row: any) => ({
          from_source_conto_id: row.from_source_conto_id,
          to_source_conto_id: row.to_source_conto_id,
          amount: row.amount,
          description: row.description,
          date: row.date,
        })),
        orders: orderRows,
        recurring_transactions: recurringRows,
      };

      const { data: importResult, error: importErr } = await supabase.rpc('import_kakebo_profile_atomic', {
        p_profile_id: profileId,
        p_payload: payload,
      });
      if (importErr) throw importErr;

      setProgress('');
      clearDirty();
      if (skippedDetails.length > 0) {
        console.warn('[KakeboImport] skipped records:', skippedDetails);
      }
      setResult({
        accounts: importResult?.accounts ?? regularConti.length,
        transactions: importResult?.transactions ?? transactionRows.filter((row: any) => row.type !== 'investment').length,
        investments: transactionRows.filter((row: any) => row.type === 'investment').length,
        transfers: importResult?.transfers ?? transferRows.length,
        orders: importResult?.orders ?? orderRows.length,
        recurring: importResult?.recurring ?? recurringRows.length,
        skipped,
        skippedDetails,
        balanceChecks,
      });
      setStep('done');
      await refreshAll();

    } catch (e: any) {
      setError(formatImportError(e));
      setStep(invDetails.length > 0 ? 'inv_details' : recurringDrafts.length > 0 ? 'recurring' : 'options');
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  const dateRange = parsed?.movimenti.length
    ? (() => { const dates = parsed.movimenti.map(m => m.dataOperazione); return { from: msToDate(Math.min(...dates)), to: msToDate(Math.max(...dates)) }; })()
    : null;

  const detectedCategories = parsed ? (() => {
    const topLevel = parsed.categorie
      .filter(c => c.padreId == null && !isInvestmentName(c.nome))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    const childrenByParent = new Map<number, string[]>();
    for (const cat of parsed.categorie) {
      if (cat.padreId == null) continue;
      if (!childrenByParent.has(cat.padreId)) childrenByParent.set(cat.padreId, []);
      childrenByParent.get(cat.padreId)!.push(cat.nome.trim());
    }
    for (const values of childrenByParent.values()) values.sort((a, b) => a.localeCompare(b, 'it'));
    return topLevel.map(cat => ({
      id: cat.id,
      name: cat.nome.trim(),
      type: cat.tipoMovimento === 1 ? 'income' : 'expense',
      subNames: childrenByParent.get(cat.id) ?? [],
    }));
  })() : [];
  const expenseCategories = detectedCategories.filter(category => category.type === 'expense');
  const incomeCategories = detectedCategories.filter(category => category.type === 'income');
  const visibleCategories = categoryView === 'expense' ? expenseCategories : incomeCategories;
  const detectedTransactionCount = parsed
    ? parsed.movimenti.filter(m => {
        if (m.tipo === -1) return false;
        if (invContoIds.has(m.contoId) && !isBonusInvestmentMovement(m, parsed.categorie)) return false;
        return true;
      }).length
    : 0;

  return (
    <div className="space-y-5">

      {/* ── Upload ── */}
      {step === 'upload' && (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('kakebo.uploadDesc', { filename: 'kakebo_db' })}
          </p>
          <button
            className="w-full py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-gray-500 dark:text-gray-400 text-sm flex flex-col items-center gap-2 hover:border-primary-400 dark:hover:border-primary-500 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v8" />
            </svg>
            <span>{t('kakebo.chooseFile', { filename: 'kakebo_db' })}</span>
          </button>
          <input ref={fileRef} type="file" className="hidden" accept=".db,.sqlite,.sqlite3,application/x-sqlite3,application/vnd.sqlite3"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          {error && <p className="mt-3 text-sm text-red-500 dark:text-red-400">{error}</p>}
        </div>
      )}

      {/* ── Options ── */}
      {step === 'options' && parsed && (
        <div className="space-y-5">
          {dateRange && (
            <div className="rounded-xl bg-gradient-to-br from-primary-50 to-white dark:from-primary-900/20 dark:to-gray-800/60 border border-primary-100 dark:border-primary-900/40 p-4 text-center">
              <div className="text-xs font-medium uppercase tracking-wide text-primary-600 dark:text-primary-400 mb-1">
                Periodo
              </div>
              <div className="text-base font-semibold text-gray-800 dark:text-gray-200">
                {dateRange.from} <span className="text-gray-400 dark:text-gray-500">→</span> {dateRange.to}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{parsed.conti.length}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('kakebo.accounts')}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{detectedTransactionCount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('kakebo.transactions')}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{detectedCategories.length}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('kakebo.categories')}</div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 p-4 space-y-2">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Conti rilevati
              </div>
              <div className="flex flex-wrap gap-2">
                {parsed.conti
                  .filter(c => !invContoIds.has(c.id))
                  .map(c => (
                    <span
                      key={`account-${c.id}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                    >
                      <span>🏦</span>
                      <span>{c.nome.trim()}</span>
                    </span>
                  ))}
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 dark:bg-gray-700/40 p-4 space-y-2">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Portafogli rilevati
              </div>
              {parsed.conti.filter(c => invContoIds.has(c.id)).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {parsed.conti
                    .filter(c => invContoIds.has(c.id))
                    .map(c => (
                      <span
                        key={`portfolio-${c.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                      >
                        <span>📈</span>
                        <span>{c.nome.trim()}</span>
                      </span>
                    ))}
                </div>
              ) : (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Nessun portafoglio rilevato automaticamente.
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={onClose}>{t('common.cancel')}</button>
            <button className="flex-1 btn-primary text-sm" onClick={() => setStep('categories')}>{t('kakebo.next')}</button>
          </div>
        </div>
      )}

      {/* ── Categories ── */}
      {step === 'categories' && parsed && (
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Categorie rilevate</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {detectedCategories.length} categorie da importare
            </div>
          </div>

          <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
            <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setCategoryView('expense')}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${categoryView === 'expense' ? 'bg-primary-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
              >
                Uscite
              </button>
              <button
                type="button"
                onClick={() => setCategoryView('income')}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${categoryView === 'income' ? 'bg-primary-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
              >
                Entrate
              </button>
            </div>

            {visibleCategories.length > 0 ? (
              visibleCategories.map(category => {
                const isExpanded = expandedCategoryIds.has(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => {
                      if (category.subNames.length === 0) return;
                      setExpandedCategoryIds(prev => {
                        const next = new Set(prev);
                        if (next.has(category.id)) next.delete(category.id);
                        else next.add(category.id);
                        return next;
                      });
                    }}
                    className="w-full text-left rounded-xl bg-gray-50 dark:bg-gray-700/40 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                          {category.name}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {category.subNames.length > 0 && (
                          <div className="text-xs text-gray-400">
                            {category.subNames.length} {category.subNames.length === 1 ? 'sottocategoria' : 'sottocategorie'}
                          </div>
                        )}
                        {category.subNames.length > 0 && (
                          <svg
                            className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        )}
                      </div>
                    </div>
                    {isExpanded && category.subNames.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {category.subNames.map(subName => (
                          <span
                            key={`${category.id}-${subName}`}
                            className="inline-flex items-center rounded-full bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                          >
                            {subName}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="text-xs text-gray-400 dark:text-gray-500">
                Nessuna categoria rilevata.
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          <div className="sticky bottom-0 bg-white dark:bg-gray-900 pt-3 border-t border-gray-100 dark:border-gray-800 flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={() => setStep('options')}>Indietro</button>
            <button className="flex-1 btn-primary text-sm" onClick={handleGoToRecurring}>{t('kakebo.next')}</button>
          </div>
        </div>
      )}

      {/* ── Recurring ── */}
      {step === 'recurring' && parsed && (
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Transazioni ricorrenti</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {recurringDrafts.length > 0
                ? `${recurringDrafts.length} regole rilevate`
                : 'Nessuna ricorrenza rilevata nel database Kakebo'}
            </div>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {recurringDrafts.length > 0 ? recurringDrafts.map((rule) => (
              <div
                key={rule.movimentoId}
                className={`rounded-2xl border p-4 space-y-3 ${rule.enabled
                  ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40'
                  : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/20 opacity-75'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-200">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        rule.type === 'income'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : rule.type === 'expense'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      }`}>
                        {rule.type === 'income' ? 'Entrata' : rule.type === 'expense' ? 'Uscita' : 'Investimento'}
                      </span>
                      <span className="truncate">{rule.category}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {rule.type === 'investment'
                        ? `${rule.accountName} → ${rule.portfolioName}`
                        : rule.subcategory
                          ? `${rule.accountName} · ${rule.subcategory}`
                          : rule.accountName}
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => updateRecurringDraft(rule.movimentoId, { enabled: e.target.checked })}
                      className="rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                    />
                    Importa
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-1">Importo</label>
                    <input
                      type="number"
                      step="0.01"
                      value={rule.amount}
                      onChange={(e) => updateRecurringDraft(rule.movimentoId, { amount: e.target.value })}
                      className="input-field text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-1">Frequenza</label>
                    <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
                      {([
                        ['weekly', 'Sett.'],
                        ['monthly', 'Mens.'],
                        ['yearly', 'Ann.'],
                      ] as const).map(([freq, label]) => (
                        <button
                          key={freq}
                          type="button"
                          onClick={() => updateRecurringDraft(rule.movimentoId, { frequency: freq })}
                          className={`flex-1 py-2 text-xs font-medium transition-colors ${
                            rule.frequency === freq
                              ? 'bg-primary-500 text-white'
                              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/70'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-1">Da</label>
                    <input
                      type="date"
                      value={rule.startDate}
                      onChange={(e) => updateRecurringDraft(rule.movimentoId, { startDate: e.target.value })}
                      className="input-field text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-400 mb-1">Descrizione</label>
                    <input
                      type="text"
                      value={rule.description}
                      onChange={(e) => updateRecurringDraft(rule.movimentoId, { description: e.target.value })}
                      placeholder="Facoltativa"
                      className="input-field text-sm"
                    />
                  </div>
                </div>
              </div>
            )) : (
              <div className="text-xs text-gray-400 dark:text-gray-500">
                Nessuna regola da rivedere.
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          <div className="sticky bottom-0 bg-white dark:bg-gray-900 pt-3 border-t border-gray-100 dark:border-gray-800 flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={() => setStep('categories')}>Indietro</button>
            <button className="flex-1 btn-primary text-sm" onClick={handleGoToInvDetails}>{t('kakebo.next')}</button>
          </div>
        </div>
      )}

      {/* ── Investment details ── */}
      {step === 'inv_details' && (
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kakebo.invDetailsTitle')}</div>
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => { setInvMode('orders'); setValidated(false); setError(null); }}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors text-center leading-snug ${invMode === 'orders' ? 'bg-primary-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
            >
              Ordini storici
              <div className={`text-xs font-normal mt-0.5 ${invMode === 'orders' ? 'text-primary-100' : 'text-gray-400'}`}>Un ordine per ogni acquisto</div>
            </button>
            <button
              type="button"
              onClick={() => { setInvMode('positions'); setValidated(false); setError(null); }}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors text-center leading-snug ${invMode === 'positions' ? 'bg-primary-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
            >
              Posizioni correnti
              <div className={`text-xs font-normal mt-0.5 ${invMode === 'positions' ? 'text-primary-100' : 'text-gray-400'}`}>Saldo attuale del portafoglio</div>
            </button>
          </div>

          {invMode === 'orders' && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Inserisci ticker, quantità e prezzo per ogni singolo acquisto. Tutti i campi sono obbligatori.
            </p>
          )}
          {invMode === 'positions' && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400">
              ⚠️ Con questa modalità il portafoglio mostrerà solo la posizione attuale e non sarà possibile analizzare lo storico degli acquisti (rendimento nel tempo, XIRR, ecc.).
            </div>
          )}

          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
            {invMode === 'orders' && invDetails.map(detail => {
              const conto = parsed?.conti.find(c => c.id === detail.destContoId);
              return (
                <div key={detail.movimentoId} id={`card-${detail.movimentoId}`}>
                  <TickerCard
                    id={String(detail.movimentoId)}
                    contoName={conto?.nome.trim() ?? '—'}
                    date={detail.date}
                    amount={detail.amount}
                    instrumentType={detail.instrumentType}
                    ticker={detail.ticker}
                    quantity={detail.quantity}
                    price={detail.price}
                    commission={detail.commission}
                    qtyLabel={t('kakebo.qty')}
                    priceLabel={t('kakebo.pricePerUnit')}
                    commissionLabel="Commissioni"
                    showValidation={validated}
                    onChange={(_, updates) => updateDetail(detail.movimentoId, updates)}
                  />
                </div>
              );
            })}

            {invMode === 'positions' && (() => {
              // Group positions by contoId
              const groups = new Map<number, InvPosition[]>();
              for (const pos of invPositions) {
                if (!groups.has(pos.contoId)) groups.set(pos.contoId, []);
                groups.get(pos.contoId)!.push(pos);
              }
              const baseGroups = new Map<number, { totalAmount: number; transferCount: number; lastDate: string }>();
              Object.values(positionDrafts).forEach(draft => {
                baseGroups.set(draft.contoId, {
                  totalAmount: draft.totalAmount,
                  transferCount: draft.transferCount,
                  lastDate: draft.lastDate,
                });
              });
              invPositions.forEach(pos => {
                if (!baseGroups.has(pos.contoId)) {
                  baseGroups.set(pos.contoId, {
                    totalAmount: pos.totalAmount,
                    transferCount: pos.transferCount,
                    lastDate: pos.lastDate,
                  });
                }
              });
              return Array.from(baseGroups.entries()).map(([contoId, info]) => {
                const positions = groups.get(contoId) ?? [];
                const conto = parsed?.conti.find(c => c.id === contoId);
                const draft = positionDrafts[contoId];
                const isDraftValid = !!draft?.ticker.trim() && !!draft?.totalQty.trim() && !!draft?.avgPrice.trim();
                return (
                  <div key={contoId} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                          📈 {conto?.nome.trim()}
                        </div>
                        <div className="text-xs text-gray-400">
                          {formatCurrency(info.totalAmount, 'EUR')} investiti · {info.transferCount} acquisti
                        </div>
                      </div>
                    </div>

                    {draft && (
                      <>
                        <TickerCard
                          id={draft.id}
                          contoName=""
                          instrumentType={draft.instrumentType}
                          ticker={draft.ticker}
                          quantity={draft.totalQty}
                          price={draft.avgPrice}
                          qtyLabel="Quantità totale"
                          priceLabel="Prezzo medio"
                          commissionLabel="Tot. Commissioni"
                          onChange={(_, updates) => updatePositionDraft(contoId, {
                            ...(updates.instrumentType !== undefined && { instrumentType: updates.instrumentType }),
                            ...(updates.ticker !== undefined && { ticker: updates.ticker }),
                            ...(updates.quantity !== undefined && { totalQty: updates.quantity }),
                            ...(updates.price !== undefined && { avgPrice: updates.price }),
                            ...(updates.isin !== undefined && { isin: updates.isin }),
                            ...(updates.name !== undefined && { name: updates.name }),
                            ...(updates.exchange !== undefined && { exchange: updates.exchange }),
                            ...(updates.ter !== undefined && { ter: updates.ter }),
                          })}
                        />
                        <div className="flex justify-end gap-2">
                          {editingPositionIds[contoId] && (
                            <button
                              type="button"
                              onClick={() => resetPositionDraft(contoId)}
                              className="px-3 py-2 rounded-xl text-xs font-medium text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                            >
                              Annulla modifica
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => addOrUpdatePosition(contoId)}
                            disabled={!isDraftValid}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-primary-500 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-600 transition-colors"
                          >
                            <span className="inline-flex w-4 h-4 items-center justify-center rounded-full bg-white/20 text-sm leading-none">✓</span>
                            <span>{editingPositionIds[contoId] ? 'Salva posizione' : 'Aggiungi posizione'}</span>
                          </button>
                        </div>
                      </>
                    )}

                    {positions.length > 0 ? (
                      <div className="space-y-1 max-h-48 overflow-y-auto border-t border-gray-100 dark:border-gray-800 pt-1">
                        {positions.map(pos => (
                          <button
                            key={pos.id}
                            type="button"
                            onClick={() => editPosition(pos)}
                            className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/60 px-3 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                                  <span className="font-mono">{pos.ticker}</span>
                                  {pos.name?.trim() && pos.name.trim().toUpperCase() !== pos.ticker.trim().toUpperCase() && (
                                    <span className="ml-2 font-medium text-gray-700 dark:text-gray-300">{pos.name.trim()}</span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  {pos.totalQty} x {formatCurrency(Number(pos.avgPrice), 'EUR')}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                                  {formatCurrency(Number(pos.totalQty) * Number(pos.avgPrice), 'EUR')}
                                </div>
                                <div className="text-xs text-gray-400">{pos.lastDate}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-2 border-t border-gray-100 dark:border-gray-800">
                        {t('portfolios.noPositions')}
                      </div>
                    )}

                    {editingPositionIds[contoId] && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={async () => {
                            const editingId = editingPositionIds[contoId];
                            if (!editingId) return;
                            if (await confirmDialog('Rimuovere questa posizione?', { title: 'Rimuovi posizione', confirmText: 'Rimuovi', isDestructive: true, noBottomOffset: true })) {
                              removePosition(editingId);
                            }
                          }}
                          className="text-xs text-red-500 dark:text-red-400 hover:text-red-600"
                        >
                          Rimuovi posizione selezionata
                        </button>
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

          <div className="sticky bottom-0 bg-white dark:bg-gray-900 pt-3 border-t border-gray-100 dark:border-gray-800 flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={() => { setError(null); setStep('recurring'); }}>Indietro</button>
            <button className="flex-1 btn-primary text-sm" onClick={() => handleImport()}>{t('kakebo.import')}</button>
          </div>
        </div>
      )}

      {/* ── Importing ── */}
      {step === 'importing' && (
        <div className="py-8 flex flex-col items-center gap-3">
          <svg className="w-10 h-10 text-primary-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm text-gray-600 dark:text-gray-400">{progress || t('kakebo.importing')}</p>
        </div>
      )}

      {/* ── Done ── */}
      {step === 'done' && result && (
        <div className="space-y-4">
          {(() => {
            const mismatches = result.balanceChecks.filter(check => Math.abs(check.diff) >= 0.01);
            return (
              <div className={`rounded-xl p-4 space-y-2 ${mismatches.length === 0 ? 'bg-blue-50 dark:bg-blue-900/20' : 'bg-amber-50 dark:bg-amber-900/20'}`}>
                <div className={`text-sm font-medium ${mismatches.length === 0 ? 'text-blue-800 dark:text-blue-300' : 'text-amber-800 dark:text-amber-300'}`}>
                  Controllo saldi finali
                </div>
                {mismatches.length === 0 ? (
                  <div className={`text-xs ${'text-blue-700 dark:text-blue-400'}`}>
                    Tutti i {result.balanceChecks.length} conti regolari quadrano con il saldo finale di Kakebo.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {mismatches.map((check) => (
                      <div key={check.contoId} className="text-xs text-amber-700 dark:text-amber-400">
                        <div className="font-medium">{check.contoName}</div>
                        <div className="opacity-80">
                          Atteso {check.expected.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} ·
                          importato {check.actual.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} ·
                          diff {check.diff.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center space-y-1">
            <div className="text-2xl">✅</div>
            <div className="font-semibold text-green-800 dark:text-green-300">{t('kakebo.importDone')}</div>
            <div className="text-sm text-green-700 dark:text-green-400 space-y-0.5">
              <div>{t('kakebo.accountsCreated', { count: result.accounts })}</div>
              <div>{t('kakebo.resultLine', { tx: result.transactions, inv: result.investments, tr: result.transfers })}</div>
              {result.recurring > 0 && <div>{result.recurring} ricorrenze create</div>}
              {result.orders > 0 && <div>{t('kakebo.ordersCreated', { count: result.orders })}</div>}
              {result.skipped > 0 && <div className="text-xs opacity-75">{t('kakebo.skipped', { count: result.skipped })}</div>}
            </div>
          </div>
          {result.skippedDetails.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 space-y-2">
              <div className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Record ignorati
              </div>
              <div className="space-y-1.5">
                {result.skippedDetails.slice(0, 5).map((item) => (
                  <div key={item.movimentoId} className="text-xs text-amber-700 dark:text-amber-400">
                    <div className="font-medium">
                      #{item.movimentoId} · {item.date} · {item.amount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}
                    </div>
                    <div className="opacity-80">
                      {item.reason}
                      {item.conto && ` · conto: ${item.conto}`}
                      {item.contoPrelievo && ` · da: ${item.contoPrelievo}`}
                    </div>
                  </div>
                ))}
              </div>
              {result.skippedDetails.length > 5 && (
                <div className="text-xs text-amber-700 dark:text-amber-400 opacity-80">
                  Altri {result.skippedDetails.length - 5} record ignorati disponibili nella console.
                </div>
              )}
            </div>
          )}
          <button className="w-full btn-primary" onClick={onClose}>{t('common.close')}</button>
        </div>
      )}
      {confirmDialogEl}
    </div>
  );
}
