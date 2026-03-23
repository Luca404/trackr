import { useState, useRef } from 'react';
import { supabase } from '../services/supabase';
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

type Step = 'upload' | 'options' | 'importing' | 'done';

export default function KakeboImport({ onClose }: Props) {
  const { accounts, categories, transactions, transfers, refreshAll } = useData();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedDB | null>(null);
  // investment account ids: transfers TO these kakebo accounts → investment transactions
  const [invContoIds, setInvContoIds] = useState<Set<number>>(new Set());
  // expense category ids to treat as 'investment' type
  const [investmentCatIds, setInvestmentCatIds] = useState<Set<number>>(new Set());
  // delete options
  const [deleteAccounts, setDeleteAccounts] = useState(false);
  const [deleteCategories, setDeleteCategories] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    accounts: number; transactions: number; investments: number; transfers: number; skipped: number;
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

      // Auto-init: investment accounts (tipo=1) → INV sentinel
      setInvContoIds(new Set(conti.filter(c => c.tipo === 1).map(c => c.id)));
      // Auto-detect investment expense categories
      setInvestmentCatIds(new Set(
        categorie.filter(c => c.padreId == null && c.tipoMovimento === 0 && isInvestmentName(c.nome)).map(c => c.id)
      ));

      setStep('options');
    } catch (e: any) {
      setError('Errore nel parsing del file: ' + (e.message || e));
    }
  };

  // ── step 3: import ──────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!parsed) return;
    setStep('importing');
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const userId = user.id;

      // 0. Delete existing data if requested
      if (deleteAccounts) {
        setProgress('Eliminazione conti e transazioni...');
        await supabase.from('transactions').delete().eq('user_id', userId);
        await supabase.from('transfers').delete().eq('user_id', userId);
        await supabase.from('accounts').delete().eq('user_id', userId);
      }
      if (deleteCategories) {
        setProgress('Eliminazione categorie...');
        await supabase.from('categories').delete().eq('user_id', userId);
      }

      // 1. Create all kakebo accounts as new trackr accounts
      setProgress('Creazione conti...');
      const contoIdMap: Record<number, number> = {};

      for (const c of parsed.conti) {
        const isInv = invContoIds.has(c.id);
        // Investment sentinel: no trackr account created, transfers → investment transactions
        if (isInv) continue;

        const icon = c.tipo === 1 ? '📈' : '🏦';
        const { data, error } = await supabase
          .from('accounts')
          .insert({ user_id: userId, name: c.nome.trim(), icon, initial_balance: 0 })
          .select()
          .single();
        if (error) throw error;
        contoIdMap[c.id] = data.id;
      }

      // 2. Build category name map & create missing categories
      setProgress('Sincronizzazione categorie...');

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

      const { data: freshCats } = await supabase.from('categories').select('*, subcategories(*)').eq('user_id', userId);
      const catCreated: Record<string, number> = {};
      for (const tc of (freshCats as CategoryWithStats[] || [])) {
        catCreated[`${tc.name.toLowerCase()}|${tc.category_type}`] = tc.id;
      }

      const getOrCreateCategory = async (name: string, type: 'expense' | 'income' | 'investment'): Promise<void> => {
        const key = `${name.toLowerCase()}|${type}`;
        if (catCreated[key]) return;
        const icon = type === 'investment' ? '📈' : type === 'income' ? '💰' : '💸';
        const { data, error } = await supabase
          .from('categories')
          .insert({ user_id: userId, name, icon, category_type: type })
          .select().single();
        if (error) throw error;
        catCreated[key] = data.id;
      };

      const getCatType = (catId: number): 'expense' | 'income' | 'investment' => {
        if (investmentCatIds.has(catId)) return 'investment';
        const cat = kCatById[catId];
        if (!cat) return 'expense';
        if (cat.padreId != null && investmentCatIds.has(cat.padreId)) return 'investment';
        return cat.tipoMovimento === 1 ? 'income' : 'expense';
      };

      // Pre-create all needed categories
      const hasInvTransfers = parsed.movimenti.some(m => m.tipo === -1 && invContoIds.has(m.contoId));
      if (hasInvTransfers) await getOrCreateCategory('Investimenti', 'investment');

      for (const m of parsed.movimenti) {
        if (m.tipo === -1 && !invContoIds.has(m.contoId)) continue;
        const catId = m.sottocategoriaId ?? m.categoriaId;
        if (catId == null) continue;
        const resolved = catResolved[catId];
        if (!resolved) continue;
        await getOrCreateCategory(resolved.catName, getCatType(catId));
      }

      // 3. Build transaction / transfer rows
      setProgress('Importazione transazioni...');
      const txRows: any[] = [];
      const trRows: any[] = [];
      let skipped = 0;

      for (const m of parsed.movimenti) {
        const date = msToDate(m.dataOperazione);
        const amount = Math.abs(m.importo1);
        const description = m.note || null;

        if (m.tipo === -1) {
          if (invContoIds.has(m.contoId)) {
            // Transfer to investment account → investment transaction from source
            const accountId = m.contoPrelievoId != null ? contoIdMap[m.contoPrelievoId] : undefined;
            if (!accountId) { skipped++; continue; }
            txRows.push({ user_id: userId, account_id: accountId, type: 'investment', category: 'Investimenti', subcategory: null, amount, description, date });
          } else {
            // Regular transfer between accounts
            const fromId = m.contoPrelievoId != null ? contoIdMap[m.contoPrelievoId] : undefined;
            const toId = contoIdMap[m.contoId];
            if (!fromId || !toId) { skipped++; continue; }
            trRows.push({ user_id: userId, from_account_id: fromId, to_account_id: toId, amount, description, date });
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

          txRows.push({ user_id: userId, account_id: accountId, type, category: catName, subcategory: subName || null, amount, description, date });
        }
      }

      // 4. Batch insert
      let txCount = 0; let invCount = 0; let trCount = 0;

      for (const batch of chunk(txRows, 500)) {
        const { error } = await supabase.from('transactions').insert(batch);
        if (error) throw error;
        txCount += batch.filter((r: any) => r.type !== 'investment').length;
        invCount += batch.filter((r: any) => r.type === 'investment').length;
      }
      for (const batch of chunk(trRows, 500)) {
        const { error } = await supabase.from('transfers').insert(batch);
        if (error) throw error;
        trCount += batch.length;
      }

      setProgress('');
      setResult({ accounts: Object.keys(contoIdMap).length, transactions: txCount, investments: invCount, transfers: trCount, skipped });
      setStep('done');
      await refreshAll();

    } catch (e: any) {
      setError(e.message || 'Errore durante l\'importazione');
      setStep('options');
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
  const existingAccountsCount = accounts.length;
  const existingCatsCount = categories.length;
  const existingTxCount = transactions.length + transfers.length;

  return (
    <div className="space-y-5">

      {/* ── Upload ── */}
      {step === 'upload' && (
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Carica il file <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">kakebo_db</code> esportato dall'app Kakebo (backup SQLite).
          </p>
          <button
            className="w-full py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-gray-500 dark:text-gray-400 text-sm flex flex-col items-center gap-2 hover:border-primary-400 dark:hover:border-primary-500 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v8" />
            </svg>
            <span>Scegli file <code>kakebo_db</code></span>
          </button>
          <input ref={fileRef} type="file" className="hidden" accept="*/*"
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
              <div className="text-xs text-gray-500 dark:text-gray-400">Conti</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{parsed.movimenti.length}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Transazioni</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{parsed.categorie.filter(c => c.padreId == null).length}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Categorie</div>
            </div>
          </div>
          {dateRange && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
              Periodo: {dateRange.from} → {dateRange.to}
            </p>
          )}

          {/* Conti da importare */}
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Conti da importare</div>
            <div className="space-y-1.5">
              {parsed.conti.map(c => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <span className="text-base">{invContoIds.has(c.id) ? '📈' : '🏦'}</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{c.nome.trim()}</span>
                  {c.tipo === 1 && (
                    <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={invContoIds.has(c.id)}
                        onChange={() => setInvContoIds(prev => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                          return next;
                        })}
                        className="w-4 h-4 rounded text-primary-500"
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400">→ inv.</span>
                    </label>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              I conti con "→ inv." non vengono creati: i trasferimenti verso di essi diventano transazioni di investimento.
            </p>
          </div>

          {/* Investment categories */}
          {expenseCats.length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categorie spesa → investimento</div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Seleziona le categorie da importare come <strong>investimenti</strong>.
              </p>
              <div className="space-y-0.5">
                {expenseCats.map(c => (
                  <label key={c.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={investmentCatIds.has(c.id)}
                      onChange={() => setInvestmentCatIds(prev => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                        return next;
                      })}
                      className="w-4 h-4 rounded text-primary-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{c.nome.trim()}</span>
                    {isInvestmentName(c.nome) && (
                      <span className="text-xs text-primary-500 dark:text-primary-400 ml-auto">auto</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Delete existing */}
          {(existingAccountsCount > 0 || existingCatsCount > 0) && (
            <div className="border border-red-200 dark:border-red-800 rounded-xl p-4 space-y-3">
              <div className="text-sm font-medium text-red-700 dark:text-red-400">⚠️ Azzera dati esistenti</div>
              {existingAccountsCount > 0 && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteAccounts}
                    onChange={e => setDeleteAccounts(e.target.checked)}
                    className="w-4 h-4 rounded mt-0.5 text-red-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Elimina {existingAccountsCount} conto/i e {existingTxCount} transazioni/trasferimenti esistenti
                  </span>
                </label>
              )}
              {existingCatsCount > 0 && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteCategories}
                    onChange={e => setDeleteCategories(e.target.checked)}
                    className="w-4 h-4 rounded mt-0.5 text-red-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Elimina {existingCatsCount} categorie esistenti
                  </span>
                </label>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={onClose}>Annulla</button>
            <button
              className={`flex-1 text-sm font-medium py-2 px-4 rounded-lg transition-colors ${deleteAccounts || deleteCategories ? 'bg-red-600 hover:bg-red-700 text-white' : 'btn-primary'}`}
              onClick={handleImport}
            >
              {deleteAccounts || deleteCategories ? '⚠️ Importa e azzera' : 'Importa'}
            </button>
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
          <p className="text-sm text-gray-600 dark:text-gray-400">{progress || 'Importazione in corso...'}</p>
        </div>
      )}

      {/* ── Done ── */}
      {step === 'done' && result && (
        <div className="space-y-4">
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center space-y-1">
            <div className="text-2xl">✅</div>
            <div className="font-semibold text-green-800 dark:text-green-300">Importazione completata</div>
            <div className="text-sm text-green-700 dark:text-green-400 space-y-0.5">
              <div>{result.accounts} conti creati</div>
              <div>{result.transactions} transazioni · {result.investments} investimenti · {result.transfers} trasferimenti</div>
              {result.skipped > 0 && <div className="text-xs opacity-75">{result.skipped} record ignorati</div>}
            </div>
          </div>
          <button className="w-full btn-primary" onClick={onClose}>Chiudi</button>
        </div>
      )}
    </div>
  );
}
