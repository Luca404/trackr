import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { apiService } from '../services/api';
import { useData } from '../contexts/DataContext';
import type { CategoryWithStats } from '../types';

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';

// ── Kakebo internal types ──────────────────────────────────────────────────────

interface KConto {
  id: number;
  nome: string;
  tipo: number;           // 0=normale, 1=investimento
}

interface KCategoria {
  id: number;
  padreId: number | null;
  tipoMovimento: number;  // 0=spesa, 1=entrata
  nome: string;
}

interface KMovimento {
  id: number;
  contoId: number;
  categoriaId: number | null;
  sottocategoriaId: number | null;
  dataOperazione: number; // Unix ms
  note: string | null;
  tipo: number;           // 0=spesa, 1=entrata, -1=trasferimento
  contoPrelievoId: number | null;
  importo1: number;
}

interface ParsedDB {
  conti: KConto[];
  categorie: KCategoria[];
  movimenti: KMovimento[];
}

// Group of investment transfers to the same portfolio with the same amount
interface InvGroup {
  groupKey: string;
  destContoId: number;
  amount: number;
  movimentoIds: number[];
  dates: string[];
  descriptions: (string | null)[];
  instrumentType: 'etf' | 'stock';
  ticker: string;
  quantity: string;
  price: string;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function msToDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

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

function isInvestmentName(name: string): boolean {
  return /investiment/i.test(name);
}

// ── InvGroupCard sub-component ─────────────────────────────────────────────────

interface InvGroupCardProps {
  group: InvGroup;
  contoName: string;
  ucitsCache: any[];
  onChange: (groupKey: string, updates: Partial<Pick<InvGroup, 'instrumentType' | 'ticker' | 'quantity' | 'price'>>) => void;
}

function InvGroupCard({ group, contoName, ucitsCache, onChange }: InvGroupCardProps) {
  const { t } = useTranslation();
  const [symbolOptions, setSymbolOptions] = useState<any[]>([]);
  const [symbolLoading, setSymbolLoading] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const skipNextSearch = useRef(false);

  const isIsin = /^[A-Z]{2}[A-Z0-9]{10}$/.test(group.ticker);

  useEffect(() => {
    if (skipNextSearch.current) { skipNextSearch.current = false; return; }
    if (!group.ticker || group.ticker.length < 1) {
      setSymbolOptions([]); setSymbolLoading(false); return;
    }
    if (isIsin) { setSymbolOptions([]); setSymbolLoading(false); return; }

    const controller = new AbortController();
    const run = async () => {
      setSymbolLoading(true);
      if (group.instrumentType === 'etf') {
        await new Promise(r => setTimeout(r, 100));
        if (controller.signal.aborted) return;
        const q = group.ticker.toUpperCase();
        const filtered = ucitsCache.filter(item => {
          const sym = (item.symbol || '').toUpperCase();
          const isin = (item.isin || '').toUpperCase();
          const name = (item.name || '').toUpperCase();
          return sym.startsWith(q) || isin.startsWith(q) || name.includes(q);
        }).slice(0, 8);
        if (!controller.signal.aborted) {
          setSymbolOptions(filtered);
          setSymbolSearchOpen(filtered.length > 0);
          setSymbolLoading(false);
        }
      } else {
        try {
          const res = await fetch(
            `${PF_BACKEND_URL}/symbols/search?q=${encodeURIComponent(group.ticker)}&instrument_type=stock`,
            { signal: controller.signal }
          );
          if (!res.ok) throw new Error();
          const data = await res.json();
          if (!controller.signal.aborted) {
            setSymbolOptions(data.results || []);
            setSymbolSearchOpen((data.results || []).length > 0);
            setSymbolLoading(false);
          }
        } catch { if (!controller.signal.aborted) setSymbolLoading(false); }
      }
    };
    const timer = setTimeout(run, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [group.ticker, group.instrumentType, ucitsCache, isIsin]);

  const selectSymbol = (item: any) => {
    skipNextSearch.current = true;
    onChange(group.groupKey, { ticker: (item.symbol || '').toUpperCase() });
    setSymbolOptions([]);
    setSymbolSearchOpen(false);
  };

  const isEmpty = !group.ticker.trim() || !group.quantity.trim() || !group.price.trim();

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📈</span>
          <div>
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{contoName}</div>
            {group.movimentoIds.length > 1 && (
              <div className="text-xs text-primary-500 dark:text-primary-400">
                ×{group.movimentoIds.length} ({group.dates[0]} → {group.dates[group.dates.length - 1]})
              </div>
            )}
            {group.movimentoIds.length === 1 && (
              <div className="text-xs text-gray-400">{group.dates[0]}</div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">
            {group.amount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}
          </div>
          {group.movimentoIds.length > 1 && (
            <div className="text-xs text-gray-400">per operazione</div>
          )}
        </div>
      </div>

      {/* ETF / Stock toggle */}
      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
        {(['etf', 'stock'] as const).map(typ => (
          <button
            key={typ}
            type="button"
            onClick={() => { onChange(group.groupKey, { instrumentType: typ, ticker: '' }); setSymbolOptions([]); setSymbolSearchOpen(false); }}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${group.instrumentType === typ ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}
          >
            {typ === 'etf' ? 'ETF' : 'Stock'}
          </button>
        ))}
      </div>

      {/* Ticker search */}
      <div className="relative">
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
          {group.instrumentType === 'etf' ? t('transactions.tickerOrIsin') : t('transactions.tickerOrName')}
        </label>
        <div className="relative">
          <input
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent uppercase font-mono"
            placeholder={group.instrumentType === 'etf' ? 'VWCE, SWDA, IE00...' : 'AAPL, MSFT...'}
            value={group.ticker}
            onChange={e => onChange(group.groupKey, { ticker: e.target.value.toUpperCase() })}
            onFocus={() => { if (symbolOptions.length > 0) setSymbolSearchOpen(true); }}
          />
          {symbolLoading && (
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
        </div>
        {symbolSearchOpen && symbolOptions.length > 0 && (
          <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden max-h-44 overflow-y-auto">
            {symbolOptions.map((item: any, i: number) => (
              <button
                key={i}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700 last:border-0"
                onClick={() => selectSymbol(item)}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs text-gray-900 dark:text-gray-100">{item.symbol}</span>
                  {item.exchange && <span className="text-xs text-gray-400">{item.exchange}</span>}
                  {item.currency && <span className="text-xs text-blue-500">{item.currency}</span>}
                </div>
                {item.name && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.name}</div>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Qty + Price */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('kakebo.qty')}</label>
          <input
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="10"
            type="number"
            min="0"
            step="any"
            value={group.quantity}
            onChange={e => onChange(group.groupKey, { quantity: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('kakebo.pricePerUnit')}</label>
          <input
            className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="100.00"
            type="number"
            min="0"
            step="any"
            value={group.price}
            onChange={e => onChange(group.groupKey, { price: e.target.value })}
          />
        </div>
      </div>

      {/* Empty warning */}
      {isEmpty && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{t('kakebo.invDetailsSkipNote')}</p>
      )}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

type Step = 'upload' | 'options' | 'inv_details' | 'importing' | 'done';

export default function KakeboImport({ onClose }: Props) {
  const { t } = useTranslation();
  const { refreshAll } = useData();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedDB | null>(null);
  const [invContoIds, setInvContoIds] = useState<Set<number>>(new Set());
  const [investmentCatIds, setInvestmentCatIds] = useState<Set<number>>(new Set());
  const [invGroups, setInvGroups] = useState<InvGroup[]>([]);
  const [ucitsCache, setUcitsCache] = useState<any[]>([]);
  const ucitsLoadedRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    accounts: number; transactions: number; investments: number; transfers: number; orders: number; skipped: number;
  } | null>(null);
  const [progress, setProgress] = useState('');

  // Load UCITS ETF cache from sessionStorage or API when inv_details step is entered
  useEffect(() => {
    if (step !== 'inv_details' || ucitsLoadedRef.current || ucitsCache.length > 0) return;
    const cached = sessionStorage.getItem('ucits_etf_list');
    if (cached) { setUcitsCache(JSON.parse(cached)); return; }
    ucitsLoadedRef.current = true;
    fetch(`${PF_BACKEND_URL}/symbols/ucits`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.etfs) {
          setUcitsCache(data.etfs);
          sessionStorage.setItem('ucits_etf_list', JSON.stringify(data.etfs));
        }
      })
      .catch(() => { ucitsLoadedRef.current = false; });
  }, [step, ucitsCache.length]);

  // ── step 1: parse file ──────────────────────────────────────────────────────

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
      const buf = await file.arrayBuffer();
      const db = new SQL.Database(new Uint8Array(buf));

      const conti = queryAll<any>(db, 'SELECT id, nome, tipo FROM Conto').map(r => ({
        id: r.id as number,
        nome: (r.nome as string) || '',
        tipo: r.tipo as number,
      }));

      const categorie = queryAll<any>(db, 'SELECT id, padreId, tipoMovimento, nome FROM Categoria').map(r => ({
        id: r.id as number,
        padreId: r.padreId as number | null,
        tipoMovimento: r.tipoMovimento as number,
        nome: (r.nome as string) || '',
      }));

      const movimenti = queryAll<any>(
        db,
        'SELECT id, contoId, categoriaId, sottocategoriaId, dataOperazione, note, tipo, contoPrelievoId, importo1 FROM Movimento'
      ).map(r => ({
        id: r.id as number,
        contoId: r.contoId as number,
        categoriaId: r.categoriaId as number | null,
        sottocategoriaId: r.sottocategoriaId as number | null,
        dataOperazione: r.dataOperazione as number,
        note: r.note as string | null,
        tipo: r.tipo as number,
        contoPrelievoId: r.contoPrelievoId as number | null,
        importo1: r.importo1 as number,
      }));

      db.close();
      setParsed({ conti, categorie, movimenti });

      setInvContoIds(new Set(
        conti.filter(c => c.tipo === 1 || isInvestmentName(c.nome)).map(c => c.id)
      ));
      setInvestmentCatIds(new Set(
        categorie.filter(c => c.padreId == null && isInvestmentName(c.nome)).map(c => c.id)
      ));

      setStep('options');
    } catch (e: any) {
      if (/failed to (fetch|load|import)/i.test(e?.message || '')) {
        window.location.reload();
        return;
      }
      setError((e.message || String(e)));
    }
  };

  // ── step 2→3: build inv groups ───────────────────────────────────────────────

  const handleGoToInvDetails = () => {
    if (!parsed) return;
    const invTransfers = parsed.movimenti.filter(m => m.tipo === -1 && invContoIds.has(m.contoId));
    if (invTransfers.length === 0) {
      handleImport();
      return;
    }

    // Group by destContoId + amount (same portfolio account, same amount = likely same recurring purchase)
    const groupMap = new Map<string, InvGroup>();
    for (const m of invTransfers) {
      const key = `${m.contoId}|${Math.abs(m.importo1)}`;
      const date = msToDate(m.dataOperazione);
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          groupKey: key,
          destContoId: m.contoId,
          amount: Math.abs(m.importo1),
          movimentoIds: [m.id],
          dates: [date],
          descriptions: [m.note || null],
          instrumentType: 'etf',
          ticker: '',
          quantity: '',
          price: '',
        });
      } else {
        const g = groupMap.get(key)!;
        g.movimentoIds.push(m.id);
        g.dates.push(date);
        g.descriptions.push(m.note || null);
      }
    }

    // Sort dates within each group
    for (const g of groupMap.values()) {
      const pairs = g.movimentoIds.map((id, i) => ({ id, date: g.dates[i], desc: g.descriptions[i] }));
      pairs.sort((a, b) => a.date.localeCompare(b.date));
      g.movimentoIds = pairs.map(p => p.id);
      g.dates = pairs.map(p => p.date);
      g.descriptions = pairs.map(p => p.desc);
    }

    setInvGroups(Array.from(groupMap.values()));
    setStep('inv_details');
  };

  const updateInvGroup = (groupKey: string, updates: Partial<Pick<InvGroup, 'instrumentType' | 'ticker' | 'quantity' | 'price'>>) => {
    setInvGroups(prev => prev.map(g => g.groupKey === groupKey ? { ...g, ...updates } : g));
  };

  // ── step 4: import ──────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!parsed) return;
    setStep('importing');
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const userId = user.id;
      const profileId = apiService.getActiveProfileId();

      // 0. Always delete existing data for active profile
      setProgress(t('kakebo.resetData'));
      await supabase.from('transactions').delete().eq('profile_id', profileId);
      await supabase.from('transfers').delete().eq('profile_id', profileId);
      await supabase.from('accounts').delete().eq('profile_id', profileId);
      await supabase.from('categories').delete().eq('profile_id', profileId);
      await supabase.from('portfolios').delete().eq('profile_id', profileId);

      // 1. Create portfolios + linked categories for investment accounts
      setProgress(t('kakebo.accounts'));
      const invContoToPortfolioId: Record<number, number> = {};
      const invContoToCategoryName: Record<number, string> = {};
      const catCreated: Record<string, number> = {};

      for (const contoId of invContoIds) {
        const conto = parsed.conti.find(c => c.id === contoId);
        if (!conto) continue;
        const name = conto.nome.trim();

        const { data: catData, error: catErr } = await supabase
          .from('categories')
          .insert({ user_id: userId, profile_id: profileId, name, icon: '📈', category_type: 'investment' })
          .select().single();
        if (catErr) throw catErr;
        catCreated[`${name.toLowerCase()}|investment`] = catData.id;

        const { data: portData, error: portErr } = await supabase
          .from('portfolios')
          .insert({
            user_id: userId,
            profile_id: profileId,
            name,
            initial_capital: 0,
            reference_currency: 'EUR',
            risk_free_source: '',
            market_benchmark: '',
            category_id: catData.id,
          })
          .select().single();
        if (portErr) throw portErr;

        invContoToPortfolioId[contoId] = portData.id;
        invContoToCategoryName[contoId] = name;
      }

      // 2. Create trackr accounts for non-investment kakebo accounts
      const contoIdMap: Record<number, number> = {};
      for (const c of parsed.conti) {
        if (invContoIds.has(c.id)) continue;
        const { data, error: accErr } = await supabase
          .from('accounts')
          .insert({ user_id: userId, profile_id: profileId, name: c.nome.trim(), icon: '🏦', initial_balance: 0 })
          .select().single();
        if (accErr) throw accErr;
        contoIdMap[c.id] = data.id;
      }

      // 3. Build category resolution map and create missing categories
      setProgress(t('kakebo.categories'));

      const kCatById: Record<number, KCategoria> = {};
      for (const c of parsed.categorie) kCatById[c.id] = c;

      const catResolved: Record<number, { catName: string; subName?: string }> = {};
      for (const c of parsed.categorie) {
        if (c.padreId == null) {
          catResolved[c.id] = { catName: c.nome.trim() };
        } else {
          const parent = kCatById[c.padreId];
          catResolved[c.id] = {
            catName: parent ? parent.nome.trim() : c.nome.trim(),
            subName: c.nome.trim(),
          };
        }
      }

      const { data: freshCats } = await supabase.from('categories').select('*, subcategories(*)').eq('profile_id', profileId);
      for (const tc of (freshCats as CategoryWithStats[] || [])) {
        catCreated[`${tc.name.toLowerCase()}|${tc.category_type}`] = tc.id;
      }

      const getOrCreateCategory = async (name: string, type: 'expense' | 'income' | 'investment'): Promise<void> => {
        const key = `${name.toLowerCase()}|${type}`;
        if (catCreated[key]) return;
        const icon = type === 'investment' ? '📈' : type === 'income' ? '💰' : '💸';
        const { data, error: catErr } = await supabase
          .from('categories')
          .insert({ user_id: userId, profile_id: profileId, name, icon, category_type: type })
          .select().single();
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
        if (catId == null) continue;
        const resolved = catResolved[catId];
        if (!resolved) continue;
        await getOrCreateCategory(resolved.catName, getCatType(catId));
      }

      // 4. Build transaction / transfer rows
      setProgress(t('kakebo.transactions'));
      const txRows: any[] = [];
      const trRows: any[] = [];
      let skipped = 0;

      // Build a map from movimentoId → group for quick lookup
      const movToGroup = new Map<number, InvGroup>();
      for (const g of invGroups) {
        for (const id of g.movimentoIds) movToGroup.set(id, g);
      }

      for (const m of parsed.movimenti) {
        const date = msToDate(m.dataOperazione);
        const amount = Math.abs(m.importo1);
        const description = m.note || null;

        if (m.tipo === -1) {
          if (invContoIds.has(m.contoId)) {
            const accountId = m.contoPrelievoId != null ? contoIdMap[m.contoPrelievoId] : undefined;
            if (!accountId) { skipped++; continue; }
            const catName = invContoToCategoryName[m.contoId] ?? 'Investimenti';
            txRows.push({ user_id: userId, profile_id: profileId, account_id: accountId, type: 'investment', category: catName, subcategory: null, amount, description, date, _movimentoId: m.id });
          } else {
            const fromId = m.contoPrelievoId != null ? contoIdMap[m.contoPrelievoId] : undefined;
            const toId = contoIdMap[m.contoId];
            if (!fromId || !toId) { skipped++; continue; }
            trRows.push({ user_id: userId, profile_id: profileId, from_account_id: fromId, to_account_id: toId, amount, description, date });
          }
        } else {
          const accountId = contoIdMap[m.contoId];
          if (!accountId) { skipped++; continue; }

          const catId = m.sottocategoriaId ?? m.categoriaId;
          let catName = 'Altro';
          let subName: string | undefined;
          if (catId != null && catResolved[catId]) {
            catName = catResolved[catId].catName;
            subName = catResolved[catId].subName;
          }

          let type: 'expense' | 'income' | 'investment' = m.tipo === 1 ? 'income' : 'expense';
          if (catId != null && getCatType(catId) === 'investment') type = 'investment';

          txRows.push({ user_id: userId, profile_id: profileId, account_id: accountId, type, category: catName, subcategory: subName || null, amount, description, date });
        }
      }

      // 5. Batch insert transactions and transfers
      let txCount = 0; let invCount = 0; let trCount = 0;

      const txRowsClean = txRows.map(({ _movimentoId: _, ...rest }) => rest);
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

      // 6. Create orders for each movimento in each group that has ticker/qty/price
      let orderCount = 0;
      for (const m of parsed.movimenti) {
        if (m.tipo !== -1 || !invContoIds.has(m.contoId)) continue;
        const grp = movToGroup.get(m.id);
        if (!grp) continue;
        if (!grp.ticker.trim() || !grp.quantity.trim() || !grp.price.trim()) continue;
        const portfolioId = invContoToPortfolioId[grp.destContoId];
        if (!portfolioId) continue;

        const { error: ordErr } = await supabase.from('orders').insert({
          user_id: userId,
          portfolio_id: portfolioId,
          symbol: grp.ticker.trim().toUpperCase(),
          currency: 'EUR',
          quantity: parseFloat(grp.quantity),
          price: parseFloat(grp.price),
          commission: 0,
          order_type: 'buy',
          date: msToDate(m.dataOperazione),
          name: m.note || undefined,
        });
        if (!ordErr) orderCount++;
      }

      setProgress('');
      setResult({ accounts: Object.keys(contoIdMap).length, transactions: txCount, investments: invCount, transfers: trCount, orders: orderCount, skipped });
      setStep('done');
      await refreshAll();

    } catch (e: any) {
      setError(e.message || String(e));
      setStep(invGroups.length > 0 ? 'inv_details' : 'options');
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  const dateRange = parsed?.movimenti.length
    ? (() => {
        const dates = parsed.movimenti.map(m => m.dataOperazione);
        return { from: msToDate(Math.min(...dates)), to: msToDate(Math.max(...dates)) };
      })()
    : null;

  const expenseCats = parsed?.categorie.filter(c => c.padreId == null && c.tipoMovimento === 0) ?? [];
  const incomeCats = parsed?.categorie.filter(c => c.padreId == null && c.tipoMovimento === 1) ?? [];
  const totalTransfers = parsed?.movimenti.filter(m => m.tipo === -1).length ?? 0;
  const invTransfers = parsed?.movimenti.filter(m => m.tipo === -1 && invContoIds.has(m.contoId)).length ?? 0;

  const toggleInvCat = (id: number) => setInvestmentCatIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
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
          {/* Summary */}
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
              {t('kakebo.transfersSummary', { total: totalTransfers, inv: invTransfers })}
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
                      <input
                        type="checkbox"
                        checked={isInv}
                        onChange={() => setInvContoIds(prev => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                          return next;
                        })}
                        className="w-4 h-4 rounded text-primary-500"
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400">→ portafoglio</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Expense categories → investment */}
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

          {/* Income categories → investment */}
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
            <button className="flex-1 btn-primary text-sm" onClick={handleGoToInvDetails}>
              {t('kakebo.next')}
            </button>
          </div>
        </div>
      )}

      {/* ── Investment details ── */}
      {step === 'inv_details' && (
        <div className="space-y-4">
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kakebo.invDetailsTitle')}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('kakebo.invDetailsDesc')}</p>
          </div>

          <div className="space-y-3">
            {invGroups.map(group => {
              const conto = parsed?.conti.find(c => c.id === group.destContoId);
              return (
                <InvGroupCard
                  key={group.groupKey}
                  group={group}
                  contoName={conto?.nome.trim() ?? '—'}
                  ucitsCache={ucitsCache}
                  onChange={updateInvGroup}
                />
              );
            })}
          </div>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={() => setStep('options')}>{t('common.cancel')}</button>
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
    </div>
  );
}
