import { useState, useRef, useEffect } from 'react';
import { useConfirm } from '../hooks/useConfirm';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { apiService } from '../services/api';
import { useData } from '../contexts/DataContext';
import type { CategoryWithStats } from '../types';

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';

// ── Kakebo internal types ──────────────────────────────────────────────────────

interface KConto { id: number; nome: string; tipo: number; variazioneSaldo1: number; }
interface KCategoria { id: number; padreId: number | null; tipoMovimento: number; nome: string; }
interface KMovimento {
  id: number; contoId: number; categoriaId: number | null; sottocategoriaId: number | null;
  dataOperazione: number; note: string | null; tipo: number; contoPrelievoId: number | null; importo1: number;
}
interface ParsedDB { conti: KConto[]; categorie: KCategoria[]; movimenti: KMovimento[]; }

// Mode A: one entry per individual investment transfer
interface InvDetail {
  movimentoId: number;
  date: string;
  amount: number;
  description: string | null;
  destContoId: number;
  instrumentType: 'etf' | 'stock' | 'bond';
  ticker: string;
  quantity: string;
  price: string;
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
function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));
}
function queryAll<T>(db: any, sql: string): T[] {
  const stmt = db.prepare(sql);
  const rows: T[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject() as T);
  stmt.free();
  return rows;
}
function isInvestmentName(name: string): boolean { return /investiment/i.test(name); }

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
  qtyLabel: string;
  priceLabel: string;
  showValidation?: boolean;
  onRemove?: () => void;
  onChange: (id: string, updates: Partial<{ instrumentType: 'etf' | 'stock' | 'bond'; ticker: string; quantity: string; price: string; isin: string; name: string; exchange: string; ter: string }>) => void;
}

function TickerCard({
  id, contoName, date, amount, totalAmount, transferCount,
  instrumentType, ticker, quantity, price, qtyLabel, priceLabel, showValidation, onRemove,
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

  const missing = showValidation && (!ticker.trim() || !quantity.trim() || !price.trim());

  return (
    <div className={`rounded-xl border p-3 space-y-3 ${missing ? 'border-red-300 dark:border-red-700' : 'border-gray-200 dark:border-gray-700'}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
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

      {/* Qty + Price */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{qtyLabel}</label>
          <input
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="10"
            type="number" min="0" step="any"
            value={quantity}
            onChange={e => onChange(id, { quantity: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{priceLabel}</label>
          <input
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="100.00"
            type="number" min="0" step="any"
            value={price}
            onChange={e => onChange(id, { price: e.target.value })}
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
type Step = 'upload' | 'options' | 'inv_details' | 'importing' | 'done';
type InvMode = 'orders' | 'positions';

export default function KakeboImport({ onClose, onDirtyChange }: Props) {
  const { t } = useTranslation();
  const { refreshAll } = useData();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedDB | null>(null);
  const [invContoIds, setInvContoIds] = useState<Set<number>>(new Set());
  const [investmentCatIds, setInvestmentCatIds] = useState<Set<number>>(new Set());

  const [invMode, setInvMode] = useState<InvMode>('orders');
  const [invDetails, setInvDetails] = useState<InvDetail[]>([]);    // mode A
  const [invPositions, setInvPositions] = useState<InvPosition[]>([]); // mode B
  const [validated, setValidated] = useState(false);

  const markDirty = () => { onDirtyChange?.(true); };
  const clearDirty = () => { onDirtyChange?.(false); };

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    accounts: number; transactions: number; investments: number; transfers: number; orders: number; skipped: number;
  } | null>(null);
  const [progress, setProgress] = useState('');

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
        db, 'SELECT id, contoId, categoriaId, sottocategoriaId, dataOperazione, note, tipo, contoPrelievoId, importo1 FROM Movimento'
      ).map(r => ({
        id: r.id as number, contoId: r.contoId as number,
        categoriaId: r.categoriaId as number | null, sottocategoriaId: r.sottocategoriaId as number | null,
        dataOperazione: r.dataOperazione as number, note: r.note as string | null,
        tipo: r.tipo as number, contoPrelievoId: r.contoPrelievoId as number | null,
        importo1: r.importo1 as number,
      }));

      db.close();
      setParsed({ conti, categorie, movimenti });
      setInvContoIds(new Set(conti.filter(c => c.tipo === 1 || isInvestmentName(c.nome)).map(c => c.id)));
      setInvestmentCatIds(new Set(categorie.filter(c => c.padreId == null && isInvestmentName(c.nome)).map(c => c.id)));
      setStep('options');
    } catch (e: any) {
      if (/failed to (fetch|load|import)/i.test(e?.message || '')) { window.location.reload(); return; }
      setError(e.message || String(e));
    }
  };

  // ── step 2→3: build inv details/positions ───────────────────────────────────

  const handleGoToInvDetails = () => {
    if (!parsed) return;
    const invTransfers = parsed.movimenti.filter(m => m.tipo === -1 && invContoIds.has(m.contoId));
    if (invTransfers.length === 0) { handleImport(); return; }

    // Build mode A: one InvDetail per transfer, sorted by date
    const details: InvDetail[] = invTransfers
      .sort((a, b) => a.dataOperazione - b.dataOperazione)
      .map(m => ({
        movimentoId: m.id,
        date: msToDate(m.dataOperazione),
        amount: Math.abs(m.importo1),
        description: m.note || null,
        destContoId: m.contoId,
        instrumentType: 'etf',
        ticker: '',
        quantity: '',
        price: '',
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
    setInvPositions(Array.from(posMap.entries()).map(([contoId, info]) => ({
      id: `${contoId}-0`,
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
    })));
    setStep('inv_details');
  };

  const updateDetail = (movimentoId: number, updates: Partial<Pick<InvDetail, 'instrumentType' | 'ticker' | 'quantity' | 'price' | 'isin' | 'name' | 'exchange' | 'ter'>>) => {
    markDirty();
    setInvDetails(prev => prev.map(d => d.movimentoId === movimentoId ? { ...d, ...updates } : d));
  };

  const updatePosition = (posId: string, updates: Partial<Pick<InvPosition, 'instrumentType' | 'ticker' | 'totalQty' | 'avgPrice' | 'isin' | 'name' | 'exchange' | 'ter'>>) => {
    markDirty();
    setInvPositions(prev => prev.map(p => p.id === posId ? { ...p, ...updates } : p));
  };

  const addPosition = (contoId: number) => {
    markDirty();
    const ref = invPositions.find(p => p.contoId === contoId)!;
    setInvPositions(prev => [...prev, {
      id: `${contoId}-${Date.now()}`,
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
    }]);
  };

  const removePosition = (posId: string) => {
    markDirty();
    setInvPositions(prev => prev.filter(p => p.id !== posId));
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

    setValidated(false);
    setStep('importing');
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const userId = user.id;
      const profileId = apiService.getActiveProfileId();

      // 0. Delete existing data
      setProgress(t('kakebo.resetData'));
      await supabase.from('transactions').delete().eq('profile_id', profileId);
      await supabase.from('transfers').delete().eq('profile_id', profileId);
      await supabase.from('accounts').delete().eq('profile_id', profileId);
      await supabase.from('categories').delete().eq('profile_id', profileId);
      await supabase.from('portfolios').delete().eq('profile_id', profileId);

      // 1. Create portfolios + categories for investment accounts
      setProgress(t('kakebo.accounts'));
      const invContoToPortfolioId: Record<number, number> = {};
      const invContoToCategoryName: Record<number, string> = {};
      const catCreated: Record<string, number> = {};

      for (const contoId of invContoIds) {
        const conto = parsed.conti.find(c => c.id === contoId);
        if (!conto) continue;
        const name = conto.nome.trim();

        const { data: portData, error: portErr } = await supabase
          .from('portfolios')
          .insert({ user_id: userId, profile_id: profileId, name, initial_capital: 0, reference_currency: 'EUR', risk_free_source: '', market_benchmark: '' })
          .select().single();
        if (portErr) throw portErr;
        invContoToPortfolioId[contoId] = portData.id;
        invContoToCategoryName[contoId] = name;
      }

      // 2. Create accounts for non-investment kakebo accounts
      // Pre-compute net transaction effects per conto (to set initial_balance = variazioneSaldo1 - net)
      const netPerConto: Record<number, number> = {};
      for (const m of parsed.movimenti) {
        const amount = Math.abs(m.importo1);
        if (m.tipo === -1) {
          if (invContoIds.has(m.contoId)) {
            // Regular → Investment: source regular account loses amount
            if (m.contoPrelievoId != null && !invContoIds.has(m.contoPrelievoId)) {
              netPerConto[m.contoPrelievoId] = (netPerConto[m.contoPrelievoId] ?? 0) - amount;
            }
          } else {
            const fromIsInv = m.contoPrelievoId != null && invContoIds.has(m.contoPrelievoId);
            if (fromIsInv) {
              // Investment → Regular: destination gains amount
              netPerConto[m.contoId] = (netPerConto[m.contoId] ?? 0) + amount;
            } else {
              // Regular → Regular transfer
              netPerConto[m.contoId] = (netPerConto[m.contoId] ?? 0) + amount;
              if (m.contoPrelievoId != null) {
                netPerConto[m.contoPrelievoId] = (netPerConto[m.contoPrelievoId] ?? 0) - amount;
              }
            }
          }
        } else {
          // expense (importo1 < 0) or income (importo1 > 0)
          if (!invContoIds.has(m.contoId)) {
            netPerConto[m.contoId] = (netPerConto[m.contoId] ?? 0) + m.importo1;
          }
        }
      }

      const contoIdMap: Record<number, number> = {};
      for (const c of parsed.conti) {
        if (invContoIds.has(c.id)) continue;
        const net = netPerConto[c.id] ?? 0;
        const initial_balance = c.variazioneSaldo1 - net;
        const { data, error: accErr } = await supabase
          .from('accounts')
          .insert({ user_id: userId, profile_id: profileId, name: c.nome.trim(), icon: '🏦', initial_balance })
          .select().single();
        if (accErr) throw accErr;
        contoIdMap[c.id] = data.id;
      }

      // 3. Category resolution
      setProgress(t('kakebo.categories'));
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

      const { data: freshCats } = await supabase.from('categories').select('*, subcategories(*)').eq('profile_id', profileId);
      for (const tc of (freshCats as CategoryWithStats[] || []))
        catCreated[`${tc.name.toLowerCase()}|${tc.category_type}`] = tc.id;

      const getOrCreateCategory = async (name: string, type: 'expense' | 'income' | 'investment') => {
        const key = `${name.toLowerCase()}|${type}`;
        if (catCreated[key]) return;
        const icon = type === 'investment' ? '📈' : type === 'income' ? '💰' : '💸';
        const { data, error: catErr } = await supabase
          .from('categories').insert({ user_id: userId, profile_id: profileId, name, icon, category_type: type }).select().single();
        if (catErr) throw catErr;
        catCreated[key] = data.id;
      };

      const getCatType = (catId: number): 'expense' | 'income' | 'investment' => {
        if (investmentCatIds.has(catId)) return 'investment';
        const cat = kCatById[catId];
        if (!cat) return 'expense';
        if (cat.padreId != null && investmentCatIds.has(cat.padreId)) return 'investment';
        return cat.tipoMovimento === 1 ? 'income' : 'expense';
      };

      for (const m of parsed.movimenti) {
        if (m.tipo === -1) continue;
        const catId = m.sottocategoriaId ?? m.categoriaId;
        if (catId == null || !catResolved[catId]) continue;
        await getOrCreateCategory(catResolved[catId].catName, getCatType(catId));
      }

      // 4. Build transaction/transfer rows
      setProgress(t('kakebo.transactions'));
      const txRows: any[] = [];
      const trRows: any[] = [];
      let skipped = 0;

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
            const accountId = m.contoPrelievoId != null ? contoIdMap[m.contoPrelievoId] : undefined;
            if (!accountId) { skipped++; continue; }
            const catName = invContoToCategoryName[m.contoId] ?? 'Investimenti';
            txRows.push({ user_id: userId, profile_id: profileId, account_id: accountId, type: 'investment', category: catName, subcategory: null, amount, description, date, _movId: m.id });
          } else {
            const fromIsInv = m.contoPrelievoId != null && invContoIds.has(m.contoPrelievoId);
            if (fromIsInv) {
              // Investment → Regular: credit the destination regular account
              const toId = contoIdMap[m.contoId];
              if (!toId) { skipped++; continue; }
              const catName = invContoToCategoryName[m.contoPrelievoId!] ?? 'Investimenti';
              txRows.push({ user_id: userId, profile_id: profileId, account_id: toId, type: 'income', category: catName, subcategory: null, amount, description, date });
            } else {
              const fromId = m.contoPrelievoId != null ? contoIdMap[m.contoPrelievoId] : undefined;
              const toId = contoIdMap[m.contoId];
              if (!fromId || !toId) { skipped++; continue; }
              trRows.push({ user_id: userId, profile_id: profileId, from_account_id: fromId, to_account_id: toId, amount, description, date });
            }
          }
        } else {
          const accountId = contoIdMap[m.contoId];
          if (!accountId) { skipped++; continue; }
          const catId = m.sottocategoriaId ?? m.categoriaId;
          let catName = 'Altro'; let subName: string | undefined;
          if (catId != null && catResolved[catId]) { catName = catResolved[catId].catName; subName = catResolved[catId].subName; }
          let type: 'expense' | 'income' | 'investment' = m.tipo === 1 ? 'income' : 'expense';
          if (catId != null && getCatType(catId) === 'investment') type = 'investment';
          txRows.push({ user_id: userId, profile_id: profileId, account_id: accountId, type, category: catName, subcategory: subName || null, amount, description, date });
        }
      }

      // 5. Batch insert
      let txCount = 0; let invCount = 0; let trCount = 0;
      const txRowsClean = txRows.map(({ _movId: _, ...rest }) => rest);
      for (const batch of chunk(txRowsClean, 500)) {
        const { error: txErr } = await supabase.from('transactions').insert(batch);
        if (txErr) throw txErr;
        txCount += batch.filter((r: any) => r.type !== 'investment').length;
        invCount += batch.filter((r: any) => r.type === 'investment').length;
      }
      for (const batch of chunk(trRows, 500)) {
        const { error: trErr } = await supabase.from('transfers').insert(batch);
        if (trErr) throw trErr;
        trCount += batch.length;
      }

      // 6. Create orders
      let orderCount = 0;
      if (invMode === 'orders') {
        // Mode A: one order per individual transfer
        for (const m of parsed.movimenti) {
          if (m.tipo !== -1 || !invContoIds.has(m.contoId)) continue;
          const detail = movToDetail.get(m.id);
          if (!detail?.ticker.trim() || !detail.quantity.trim() || !detail.price.trim()) continue;
          const portfolioId = invContoToPortfolioId[detail.destContoId];
          if (!portfolioId) continue;
          const { error: ordErr } = await supabase.from('orders').insert({
            user_id: userId, portfolio_id: portfolioId,
            symbol: detail.ticker.trim().toUpperCase(), currency: 'EUR',
            quantity: parseFloat(detail.quantity), price: parseFloat(detail.price),
            commission: 0, order_type: 'buy', date: detail.date,
            instrument_type: detail.instrumentType,
            isin: detail.isin || undefined,
            name: detail.name || undefined,
            exchange: detail.exchange || undefined,
            ter: detail.ter || undefined,
          });
          if (ordErr) throw ordErr;
          orderCount++;
        }
      } else {
        // Mode B: one order per portfolio position (current state)
        for (const pos of invPositions) {
          if (!pos.ticker.trim() || !pos.totalQty.trim() || !pos.avgPrice.trim()) continue;
          const portfolioId = invContoToPortfolioId[pos.contoId];
          if (!portfolioId) continue;
          const { error: ordErr } = await supabase.from('orders').insert({
            user_id: userId, portfolio_id: portfolioId,
            symbol: pos.ticker.trim().toUpperCase(), currency: 'EUR',
            quantity: parseFloat(pos.totalQty), price: parseFloat(pos.avgPrice),
            commission: 0, order_type: 'buy', date: pos.lastDate,
            instrument_type: pos.instrumentType,
            isin: pos.isin || undefined,
            name: pos.name || undefined,
            exchange: pos.exchange || undefined,
            ter: pos.ter || undefined,
          });
          if (ordErr) throw ordErr;
          orderCount++;
        }
      }

      setProgress('');
      clearDirty();
      setResult({ accounts: Object.keys(contoIdMap).length, transactions: txCount, investments: invCount, transfers: trCount, orders: orderCount, skipped });
      setStep('done');
      await refreshAll();

    } catch (e: any) {
      setError(e.message || String(e));
      setStep(invDetails.length > 0 ? 'inv_details' : 'options');
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  const dateRange = parsed?.movimenti.length
    ? (() => { const dates = parsed.movimenti.map(m => m.dataOperazione); return { from: msToDate(Math.min(...dates)), to: msToDate(Math.max(...dates)) }; })()
    : null;

  const expenseCats = parsed?.categorie.filter(c => c.padreId == null && c.tipoMovimento === 0) ?? [];
  const incomeCats = parsed?.categorie.filter(c => c.padreId == null && c.tipoMovimento === 1) ?? [];
  const totalTransfers = parsed?.movimenti.filter(m => m.tipo === -1).length ?? 0;
  const invTransfersCount = parsed?.movimenti.filter(m => m.tipo === -1 && invContoIds.has(m.contoId)).length ?? 0;

  const toggleInvCat = (id: number) => setInvestmentCatIds(prev => {
    const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });

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
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{parsed.conti.length}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('kakebo.accounts')}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{parsed.movimenti.length}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('kakebo.transactions')}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{parsed.categorie.filter(c => c.padreId == null).length}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{t('kakebo.categories')}</div>
            </div>
          </div>
          {totalTransfers > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              {t('kakebo.transfersSummary', { total: totalTransfers, inv: invTransfersCount })}
            </p>
          )}
          {dateRange && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              {t('kakebo.period', { from: dateRange.from, to: dateRange.to })}
            </p>
          )}

          {/* Accounts */}
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kakebo.accountsToImport')}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('kakebo.invNote')}</p>
            <div className="space-y-1.5">
              {parsed.conti.map(c => {
                const isInv = invContoIds.has(c.id);
                return (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                    <span className="text-base">{isInv ? '📈' : '🏦'}</span>
                    <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{c.nome.trim()}</span>
                    <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                      <input type="checkbox" checked={isInv}
                        onChange={() => setInvContoIds(prev => { const next = new Set(prev); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; })}
                        className="w-4 h-4 rounded text-primary-500" />
                      <span className="text-xs text-gray-500 dark:text-gray-400">→ portafoglio</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          {expenseCats.length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kakebo.expenseToInv')}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('kakebo.expenseToInvDesc')}</p>
              <div className="space-y-0.5">
                {expenseCats.map(c => (
                  <label key={c.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                    <input type="checkbox" checked={investmentCatIds.has(c.id)} onChange={() => toggleInvCat(c.id)} className="w-4 h-4 rounded text-primary-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{c.nome.trim()}</span>
                    {isInvestmentName(c.nome) && <span className="text-xs text-primary-500 dark:text-primary-400 ml-auto">auto</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {incomeCats.length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kakebo.incomeToInv')}</div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('kakebo.incomeToInvDesc')}</p>
              <div className="space-y-0.5">
                {incomeCats.map(c => (
                  <label key={c.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                    <input type="checkbox" checked={investmentCatIds.has(c.id)} onChange={() => toggleInvCat(c.id)} className="w-4 h-4 rounded text-primary-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{c.nome.trim()}</span>
                    {isInvestmentName(c.nome) && <span className="text-xs text-primary-500 dark:text-primary-400 ml-auto">auto</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={onClose}>{t('common.cancel')}</button>
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

          <div className="space-y-3">
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
                    qtyLabel={t('kakebo.qty')}
                    priceLabel={t('kakebo.pricePerUnit')}
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
              return Array.from(groups.entries()).map(([contoId, positions]) => {
                const conto = parsed?.conti.find(c => c.id === contoId);
                return (
                  <div key={contoId} className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        📈 {conto?.nome.trim()}
                      </span>
                      <span className="text-xs text-gray-400">
                        {positions[0].totalAmount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })} investiti · {positions[0].transferCount} acquisti
                      </span>
                    </div>
                    {positions.map(pos => (
                      <TickerCard
                        key={pos.id}
                        id={pos.id}
                        contoName=""
                        instrumentType={pos.instrumentType}
                        ticker={pos.ticker}
                        quantity={pos.totalQty}
                        price={pos.avgPrice}
                        qtyLabel="Quantità totale"
                        priceLabel="Prezzo medio di carico"
                        onRemove={positions.length > 1 ? async () => { if (await confirmDialog('Rimuovere questa posizione?', { title: 'Rimuovi posizione', confirmText: 'Rimuovi', isDestructive: true })) removePosition(pos.id); } : undefined}
                        onChange={(_, updates) => updatePosition(pos.id, {
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
                    ))}
                    <button
                      type="button"
                      className="w-full py-2 text-xs text-primary-500 dark:text-primary-400 border border-dashed border-primary-300 dark:border-primary-700 rounded-xl hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors inline-flex items-center justify-center gap-1"
                      onClick={() => addPosition(contoId)}
                    >
                      <span className="inline-flex w-3 items-center justify-center text-sm leading-none">+</span>
                      <span>Aggiungi posizione</span>
                    </button>
                  </div>
                );
              });
            })()}
          </div>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={() => { setError(null); clearDirty(); setStep('options'); }}>{t('common.cancel')}</button>
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
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center space-y-1">
            <div className="text-2xl">✅</div>
            <div className="font-semibold text-green-800 dark:text-green-300">{t('kakebo.importDone')}</div>
            <div className="text-sm text-green-700 dark:text-green-400 space-y-0.5">
              <div>{t('kakebo.accountsCreated', { count: result.accounts })}</div>
              <div>{t('kakebo.resultLine', { tx: result.transactions, inv: result.investments, tr: result.transfers })}</div>
              {result.orders > 0 && <div>{t('kakebo.ordersCreated', { count: result.orders })}</div>}
              {result.skipped > 0 && <div className="text-xs opacity-75">{t('kakebo.skipped', { count: result.skipped })}</div>}
            </div>
          </div>
          <button className="w-full btn-primary" onClick={onClose}>{t('common.close')}</button>
        </div>
      )}
      {confirmDialogEl}
    </div>
  );
}
