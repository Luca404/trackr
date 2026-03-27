import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../services/supabase';
import { apiService } from '../services/api';
import { useData } from '../contexts/DataContext';
import type { CategoryWithStats } from '../types';

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

interface InvDetail {
  movimentoId: number;
  date: string;
  amount: number;
  description: string | null;
  destContoId: number;   // kakebo inv account id
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

// ── main component ─────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

type Step = 'upload' | 'options' | 'inv_details' | 'importing' | 'done';

export default function KakeboImport({ onClose }: Props) {
  const { t } = useTranslation();
  const { accounts, categories, transactions, transfers, refreshAll } = useData();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedDB | null>(null);
  // investment account ids: these become portfolios + categories
  const [invContoIds, setInvContoIds] = useState<Set<number>>(new Set());
  // expense/income category ids to treat as 'investment' type
  const [investmentCatIds, setInvestmentCatIds] = useState<Set<number>>(new Set());
  // details for investment transfers (ticker/qty/price per movement)
  const [invDetails, setInvDetails] = useState<InvDetail[]>([]);
  // delete options
  const [deleteAccounts, setDeleteAccounts] = useState(false);
  const [deleteCategories, setDeleteCategories] = useState(false);

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

      // Auto-detect investment accounts (tipo=1 or name match)
      setInvContoIds(new Set(
        conti.filter(c => c.tipo === 1 || isInvestmentName(c.nome)).map(c => c.id)
      ));
      // Auto-detect investment expense categories
      setInvestmentCatIds(new Set(
        categorie.filter(c => c.padreId == null && isInvestmentName(c.nome)).map(c => c.id)
      ));

      setStep('options');
    } catch (e: any) {
      // Chunk load failure after a new deploy → reload to get fresh bundle
      if (/failed to (fetch|load|import)/i.test(e?.message || '')) {
        window.location.reload();
        return;
      }
      setError((e.message || String(e)));
    }
  };

  // ── step 2→3: go to inv details ─────────────────────────────────────────────

  const handleGoToInvDetails = () => {
    if (!parsed) return;
    const invTransfers = parsed.movimenti.filter(m => m.tipo === -1 && invContoIds.has(m.contoId));
    if (invTransfers.length === 0) {
      handleImport([]);
      return;
    }
    setInvDetails(invTransfers.map(m => ({
      movimentoId: m.id,
      date: msToDate(m.dataOperazione),
      amount: Math.abs(m.importo1),
      description: m.note || null,
      destContoId: m.contoId,
      ticker: '',
      quantity: '',
      price: '',
    })));
    setStep('inv_details');
  };

  const updateInvDetail = (movimentoId: number, field: keyof Pick<InvDetail, 'ticker' | 'quantity' | 'price'>, value: string) => {
    setInvDetails(prev => prev.map(d => d.movimentoId === movimentoId ? { ...d, [field]: value } : d));
  };

  // ── step 4: import ──────────────────────────────────────────────────────────

  const handleImport = async (details: InvDetail[]) => {
    if (!parsed) return;
    setStep('importing');
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const userId = user.id;
      const profileId = apiService.getActiveProfileId();

      // 0. Delete existing data if requested
      if (deleteAccounts) {
        setProgress(t('kakebo.resetData'));
        await supabase.from('transactions').delete().eq('profile_id', profileId);
        await supabase.from('transfers').delete().eq('profile_id', profileId);
        await supabase.from('accounts').delete().eq('profile_id', profileId);
      }
      if (deleteCategories) {
        setProgress(t('kakebo.resetData'));
        await supabase.from('categories').delete().eq('profile_id', profileId);
      }

      // 1. Create portfolios + linked categories for investment accounts
      setProgress(t('kakebo.accounts'));
      const invContoToPortfolioId: Record<number, number> = {};
      const invContoToCategoryName: Record<number, string> = {};
      const catCreated: Record<string, number> = {};

      for (const contoId of invContoIds) {
        const conto = parsed.conti.find(c => c.id === contoId);
        if (!conto) continue;
        const name = conto.nome.trim();

        // Create investment category
        const { data: catData, error: catErr } = await supabase
          .from('categories')
          .insert({ user_id: userId, profile_id: profileId, name, icon: '📈', category_type: 'investment' })
          .select().single();
        if (catErr) throw catErr;
        catCreated[`${name.toLowerCase()}|investment`] = catData.id;

        // Create portfolio linked to category
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

      // Load existing categories
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

      // Pre-create categories for regular transactions
      for (const m of parsed.movimenti) {
        if (m.tipo === -1) continue; // transfers handled separately
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

      for (const m of parsed.movimenti) {
        const date = msToDate(m.dataOperazione);
        const amount = Math.abs(m.importo1);
        const description = m.note || null;

        if (m.tipo === -1) {
          if (invContoIds.has(m.contoId)) {
            // Transfer to investment account → investment transaction from source account
            const accountId = m.contoPrelievoId != null ? contoIdMap[m.contoPrelievoId] : undefined;
            if (!accountId) { skipped++; continue; }
            const catName = invContoToCategoryName[m.contoId] ?? 'Investimenti';
            txRows.push({ user_id: userId, profile_id: profileId, account_id: accountId, type: 'investment', category: catName, subcategory: null, amount, description, date, _movimentoId: m.id });
          } else {
            // Regular transfer between accounts
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

      // Strip internal _movimentoId before insert
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

      // 6. Create orders for investment transfers that have ticker/qty/price
      let orderCount = 0;
      for (const detail of details) {
        if (!detail.ticker.trim() || !detail.quantity.trim() || !detail.price.trim()) continue;
        const portfolioId = invContoToPortfolioId[detail.destContoId];
        if (!portfolioId) continue;

        const { error: ordErr } = await supabase.from('orders').insert({
          user_id: userId,
          portfolio_id: portfolioId,
          symbol: detail.ticker.trim().toUpperCase(),
          currency: 'EUR',
          quantity: parseFloat(detail.quantity),
          price: parseFloat(detail.price),
          commission: 0,
          order_type: 'buy',
          date: detail.date,
          name: detail.description || undefined,
        });
        if (!ordErr) orderCount++;
      }

      setProgress('');
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
    ? (() => {
        const dates = parsed.movimenti.map(m => m.dataOperazione);
        return { from: msToDate(Math.min(...dates)), to: msToDate(Math.max(...dates)) };
      })()
    : null;

  const expenseCats = parsed?.categorie.filter(c => c.padreId == null && c.tipoMovimento === 0) ?? [];
  const incomeCats = parsed?.categorie.filter(c => c.padreId == null && c.tipoMovimento === 1) ?? [];
  const existingAccountsCount = accounts.length;
  const existingCatsCount = categories.length;
  const existingTxCount = transactions.length + transfers.length;

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
                    {(c.tipo === 1 || isInvestmentName(c.nome)) && !isInv && (
                      <span className="text-xs text-primary-500 dark:text-primary-400">auto</span>
                    )}
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

          {/* Income categories → investment (e.g. dividends) */}
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

          {/* Delete existing */}
          {(existingAccountsCount > 0 || existingCatsCount > 0) && (
            <div className="border border-red-200 dark:border-red-800 rounded-xl p-4 space-y-3">
              <div className="text-sm font-medium text-red-700 dark:text-red-400">{t('kakebo.resetData')}</div>
              {existingAccountsCount > 0 && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={deleteAccounts} onChange={e => setDeleteAccounts(e.target.checked)} className="w-4 h-4 rounded mt-0.5 text-red-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('kakebo.deleteAccountsLabel', { accounts: existingAccountsCount, txs: existingTxCount })}
                  </span>
                </label>
              )}
              {existingCatsCount > 0 && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={deleteCategories} onChange={e => setDeleteCategories(e.target.checked)} className="w-4 h-4 rounded mt-0.5 text-red-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('kakebo.deleteCatsLabel', { count: existingCatsCount })}
                  </span>
                </label>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={onClose}>{t('common.cancel')}</button>
            <button
              className={`flex-1 text-sm font-medium py-2 px-4 rounded-lg transition-colors ${deleteAccounts || deleteCategories ? 'bg-red-600 hover:bg-red-700 text-white' : 'btn-primary'}`}
              onClick={handleGoToInvDetails}
            >
              {deleteAccounts || deleteCategories ? t('kakebo.importAndReset') : t('kakebo.next')}
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
            {invDetails.map(detail => {
              const conto = parsed?.conti.find(c => c.id === detail.destContoId);
              return (
                <div key={detail.movimentoId} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">📈</span>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{conto?.nome.trim()}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">
                        {detail.amount.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}
                      </div>
                      <div className="text-xs text-gray-400">{detail.date}</div>
                    </div>
                  </div>
                  {detail.description && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 italic">{detail.description}</div>
                  )}
                  {/* Order inputs */}
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('kakebo.ticker')}</label>
                      <input
                        className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent uppercase"
                        placeholder="VWCE"
                        value={detail.ticker}
                        onChange={e => updateInvDetail(detail.movimentoId, 'ticker', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('kakebo.qty')}</label>
                      <input
                        className="w-full px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        placeholder="10"
                        type="number"
                        min="0"
                        step="any"
                        value={detail.quantity}
                        onChange={e => updateInvDetail(detail.movimentoId, 'quantity', e.target.value)}
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
                        value={detail.price}
                        onChange={e => updateInvDetail(detail.movimentoId, 'price', e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">{t('kakebo.invDetailsSkipNote')}</p>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={() => setStep('options')}>{t('common.cancel')}</button>
            <button className="flex-1 btn-primary text-sm" onClick={() => handleImport(invDetails)}>{t('kakebo.import')}</button>
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
