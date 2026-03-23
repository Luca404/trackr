import { useState, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useData } from '../contexts/DataContext';
import type { CategoryWithStats } from '../types';

// ── Kakebo internal types ──────────────────────────────────────────────────────

interface KConto {
  id: number;
  nome: string;
  tipo: number;           // 0=normale, 1=investimento
  variazioneSaldo1: number;
  includiInSaldo: number;
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

// ── main component ─────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

type Step = 'upload' | 'mapping' | 'importing' | 'done';

export default function KakeboImport({ onClose }: Props) {
  const { accounts, refreshAll } = useData();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('upload');
  const [parsed, setParsed] = useState<ParsedDB | null>(null);
  const [accountMap, setAccountMap] = useState<Record<number, string>>({});
  // value: trackr account id (string), '' = skip, 'new' = create new
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ transactions: number; transfers: number; skipped: number } | null>(null);
  const [progress, setProgress] = useState('');

  // ── step 1: parse file ──────────────────────────────────────────────────────

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
      const buf = await file.arrayBuffer();
      const db = new SQL.Database(new Uint8Array(buf));

      const conti = queryAll<any>(db, 'SELECT id, nome, tipo, variazioneSaldo1, includiInSaldo FROM Conto').map(r => ({
        id: r.id as number,
        nome: (r.nome as string) || '',
        tipo: r.tipo as number,
        variazioneSaldo1: r.variazioneSaldo1 as number,
        includiInSaldo: r.includiInSaldo as number,
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

      // Init account map: try to auto-match by name
      const initMap: Record<number, string> = {};
      for (const c of conti) {
        const match = accounts.find(a => a.name.toLowerCase() === c.nome.toLowerCase().trim());
        initMap[c.id] = match ? String(match.id) : '';
      }
      setAccountMap(initMap);
      setStep('mapping');
    } catch (e: any) {
      setError('Errore nel parsing del file: ' + (e.message || e));
    }
  };

  // ── step 2: account mapping ─────────────────────────────────────────────────

  // ── step 3: import ──────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!parsed) return;
    setStep('importing');
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const userId = user.id;

      // 1. Resolve / create accounts
      setProgress('Creazione conti...');
      const contoIdMap: Record<number, number> = {}; // kakebo id → trackr id

      for (const c of parsed.conti) {
        const mapped = accountMap[c.id];
        if (!mapped || mapped === '') continue; // skip
        if (mapped === 'new') {
          const { data, error } = await supabase
            .from('accounts')
            .insert({ user_id: userId, name: c.nome.trim(), icon: '🏦', initial_balance: 0 })
            .select()
            .single();
          if (error) throw error;
          contoIdMap[c.id] = data.id;
        } else {
          contoIdMap[c.id] = parseInt(mapped);
        }
      }

      // 2. Resolve / create categories + subcategories
      setProgress('Sincronizzazione categorie...');

      // Map: kakebo cat id → { trackrCategoryName, trackrSubcategoryName? }
      const catResolved: Record<number, { catName: string; subName?: string }> = {};

      // Current trackr categories (reload fresh)
      const { data: freshCats } = await supabase.from('categories').select('*, subcategories(*)').eq('user_id', userId);
      const trackrCats: CategoryWithStats[] = freshCats || [];

      // Helper: find or create category
      const catCreated: Record<string, number> = {}; // name_type → trackr category id
      for (const tc of trackrCats) {
        catCreated[`${tc.name.toLowerCase()}|${tc.category_type}`] = tc.id;
      }

      const getOrCreateCategory = async (name: string, type: 'expense' | 'income'): Promise<number> => {
        const key = `${name.toLowerCase()}|${type}`;
        if (catCreated[key]) return catCreated[key];
        const { data, error } = await supabase
          .from('categories')
          .insert({ user_id: userId, name, icon: type === 'expense' ? '💸' : '💰', category_type: type })
          .select()
          .single();
        if (error) throw error;
        catCreated[key] = data.id;
        return data.id;
      };

      // subcategory cache: catId_subName → sub id (not strictly needed since we use name string)
      // In trackr, category is stored as a name string in transactions, subcategory also as string
      // So we just need to map kakebo cat → name strings

      // Build kakebo parent categories map
      const kCatById: Record<number, KCategoria> = {};
      for (const c of parsed.categorie) kCatById[c.id] = c;

      for (const c of parsed.categorie) {
        if (c.padreId == null) {
          // main category
          catResolved[c.id] = { catName: c.nome.trim() };
        } else {
          // subcategory
          const parent = kCatById[c.padreId];
          catResolved[c.id] = {
            catName: parent ? parent.nome.trim() : c.nome.trim(),
            subName: c.nome.trim(),
          };
        }
      }

      // Pre-create categories that will be used
      const usedCatIds = new Set<number>();
      for (const m of parsed.movimenti) {
        if (m.tipo === -1) continue; // transfer — no category
        const catId = m.sottocategoriaId ?? m.categoriaId;
        if (catId != null) usedCatIds.add(catId);
        else if (m.categoriaId != null) usedCatIds.add(m.categoriaId);
      }

      for (const cid of usedCatIds) {
        const resolved = catResolved[cid];
        if (!resolved) continue;
        const tipo = kCatById[cid]?.tipoMovimento ?? (kCatById[kCatById[cid]?.padreId ?? -1]?.tipoMovimento ?? 0);
        const type = tipo === 0 ? 'expense' : 'income';
        await getOrCreateCategory(resolved.catName, type);
      }

      // 3. Batch insert transactions
      setProgress('Importazione transazioni...');

      const txRows: any[] = [];
      const trRows: any[] = [];
      let skipped = 0;

      for (const m of parsed.movimenti) {
        const date = msToDate(m.dataOperazione);
        const amount = Math.abs(m.importo1);
        const description = m.note || null;

        if (m.tipo === -1) {
          // Transfer
          const fromId = contoIdMap[m.contoPrelievoId!];
          const toId = contoIdMap[m.contoId];
          if (!fromId || !toId) { skipped++; continue; }
          trRows.push({
            user_id: userId,
            from_account_id: fromId,
            to_account_id: toId,
            amount,
            description,
            date,
          });
        } else {
          const accountId = contoIdMap[m.contoId];
          if (!accountId) { skipped++; continue; }

          const type = m.tipo === 1 ? 'income' : 'expense';
          const catId = m.sottocategoriaId ?? m.categoriaId;
          let catName = 'Altro';
          let subName: string | undefined;

          if (catId != null && catResolved[catId]) {
            catName = catResolved[catId].catName;
            subName = catResolved[catId].subName;
          } else if (m.categoriaId != null && catResolved[m.categoriaId]) {
            catName = catResolved[m.categoriaId].catName;
          }

          txRows.push({
            user_id: userId,
            account_id: accountId,
            type,
            category: catName,
            subcategory: subName || null,
            amount,
            description,
            date,
          });
        }
      }

      // Insert in chunks of 500
      let txCount = 0;
      for (const batch of chunk(txRows, 500)) {
        const { error } = await supabase.from('transactions').insert(batch);
        if (error) throw error;
        txCount += batch.length;
      }

      let trCount = 0;
      for (const batch of chunk(trRows, 500)) {
        const { error } = await supabase.from('transfers').insert(batch);
        if (error) throw error;
        trCount += batch.length;
      }

      setProgress('');
      setResult({ transactions: txCount, transfers: trCount, skipped });
      setStep('done');
      await refreshAll();

    } catch (e: any) {
      setError(e.message || 'Errore durante l\'importazione');
      setStep('mapping');
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  const dateRange = parsed?.movimenti.length
    ? (() => {
        const dates = parsed.movimenti.map(m => m.dataOperazione);
        return {
          from: msToDate(Math.min(...dates)),
          to: msToDate(Math.max(...dates)),
        };
      })()
    : null;

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
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="*"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          {error && <p className="mt-3 text-sm text-red-500 dark:text-red-400">{error}</p>}
        </div>
      )}

      {/* ── Mapping ── */}
      {step === 'mapping' && parsed && (
        <div className="space-y-4">
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

          {/* Account mapping */}
          <div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Associa i conti Kakebo ai tuoi conti Trackr
            </div>
            <div className="space-y-2">
              {parsed.conti.map(c => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300 w-32 shrink-0 truncate">{c.nome}</span>
                  <select
                    className="flex-1 input text-sm py-1.5"
                    value={accountMap[c.id] ?? ''}
                    onChange={e => setAccountMap(prev => ({ ...prev, [c.id]: e.target.value }))}
                  >
                    <option value="">— Ignora —</option>
                    <option value="new">+ Crea nuovo</option>
                    {accounts.map(a => (
                      <option key={a.id} value={String(a.id)}>{a.icon} {a.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Le categorie verranno create automaticamente se non esistono già.
          </p>

          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button className="flex-1 btn-secondary text-sm" onClick={onClose}>Annulla</button>
            <button className="flex-1 btn-primary text-sm" onClick={handleImport}>
              Importa
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
            <div className="text-sm text-green-700 dark:text-green-400">
              {result.transactions} transazioni · {result.transfers} trasferimenti
              {result.skipped > 0 && ` · ${result.skipped} ignorati`}
            </div>
          </div>
          <button className="w-full btn-primary" onClick={onClose}>Chiudi</button>
        </div>
      )}
    </div>
  );
}
