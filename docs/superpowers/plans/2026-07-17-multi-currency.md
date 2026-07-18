# Multi-Currency Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conti con più valute a saldi separati (stile Revolut): spese/entrate in valuta, trasferimenti e cambi cross-currency, totali convertiti in EUR via tassi BCE.

**Architecture:** Nuova tabella `account_currencies` + colonne additive su `transactions`/`transfers`/`recurring_transactions` (default `'EUR'`, zero breaking per pfTrackr). Servizio FX client-side (frankfurter.dev, cache 24h) con snapshot `base_amount` immutabile per le stats. Calcolo saldi estratto in funzione pura `computeBalances`.

**Tech Stack:** React 18 TS, Supabase JS, Vitest (nuovo), Playwright E2E (ricetta esistente), frankfurter.dev.

**Spec:** `docs/superpowers/specs/2026-07-17-multi-currency-design.md` — fa fede per ogni ambiguità.

## Global Constraints

- Valute v1: `'EUR' | 'USD' | 'GBP' | 'CHF' | 'JPY'`. Base fissa `'EUR'` (costante `BASE_CURRENCY`).
- EUR sempre attiva su ogni conto, non rimovibile.
- Investment: sempre `currency='EUR'`, nessun picker.
- FX mai bloccante: submit procede sempre (fallback → `base_amount NULL` + backfill lazy).
- `base_amount NULL` su EUR (controvalore = amount). Arrotondamento snapshot: 2 decimali.
- Migrazioni: applicare prima su Supabase locale (CLI da `Python/`), staging prima di prod (regola repo).
- Commit su branch `dev`, messaggi one-liner senza body né trailer (preferenza utente).
- Gate per ogni task: `npx tsc -b` pulito. Test: `npx vitest run`.
- Currency formatting: sempre `SettingsContext.formatCurrency(amount, currency)`.

---

### Task 1: Migrazione SQL + docs schema

**Files:**
- Create: `../supabase/migrations/20260717_multi_currency.sql` (path da root `Trackrs/`)
- Modify: `../docs/supabase-schema.md` (sezioni accounts/transactions/transfers)

**Interfaces:**
- Produces: tabella `account_currencies(id, account_id, profile_id, currency, initial_balance, created_at)`; colonne `transactions.currency/base_amount`, `transfers.from_currency/to_currency/to_amount`, `recurring_transactions.currency`.

- [ ] **Step 1: Scrivi la migrazione**

```sql
-- 20260717_multi_currency.sql
CREATE TABLE IF NOT EXISTS account_currencies (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (currency IN ('EUR','USD','GBP','CHF','JPY')),
  initial_balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(account_id, currency)
);

ALTER TABLE account_currencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_currencies_select" ON account_currencies
  FOR SELECT USING (is_profile_member(profile_id, auth.uid()));
CREATE POLICY "account_currencies_insert" ON account_currencies
  FOR INSERT WITH CHECK (is_profile_member(profile_id, auth.uid()));
CREATE POLICY "account_currencies_update" ON account_currencies
  FOR UPDATE USING (is_profile_member(profile_id, auth.uid()));
CREATE POLICY "account_currencies_delete" ON account_currencies
  FOR DELETE USING (is_profile_member(profile_id, auth.uid()));

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS base_amount NUMERIC NULL;

ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS from_currency TEXT NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS to_currency TEXT NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS to_amount NUMERIC NULL;

ALTER TABLE recurring_transactions
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';

-- Backfill: riga EUR per ogni conto esistente (idempotente)
INSERT INTO account_currencies (account_id, profile_id, currency, initial_balance)
SELECT id, profile_id, 'EUR', initial_balance FROM accounts
ON CONFLICT (account_id, currency) DO NOTHING;
```

- [ ] **Step 2: Applica su Supabase locale**

Da `/home/lika44/Documenti/Python`:
```bash
supabase db push --local
```
(oppure `psql` contro il DB locale 54321 se push non applicabile). Expected: nessun errore.

- [ ] **Step 3: Verifica**

```bash
psql "$(supabase status --output json | jq -r '.DB_URL // empty' 2>/dev/null || echo postgresql://postgres:postgres@127.0.0.1:54322/postgres)" \
  -c "SELECT a.name, ac.currency, ac.initial_balance FROM account_currencies ac JOIN accounts a ON a.id=ac.account_id LIMIT 5;" \
  -c "\d transactions" | grep -E "currency|base_amount"
```
Expected: una riga EUR per conto; colonne presenti.

- [ ] **Step 4: Aggiorna `docs/supabase-schema.md`** — aggiungi sotto `### accounts`:

```markdown
### `account_currencies`
`id SERIAL PK`, `account_id` (FK accounts ON DELETE CASCADE), `profile_id UUID`, `currency` ('EUR'|'USD'|'GBP'|'CHF'|'JPY'), `initial_balance NUMERIC`, `created_at`, UNIQUE(account_id, currency)
- Valute attive per conto. Riga EUR sempre presente (creata con il conto, non rimovibile da UI).
- `accounts.initial_balance` è DEPRECATA: fonte di verità = riga EUR qui. Resta per compat pfTrackr.
```
e annota su `transactions` (`currency` default 'EUR', `base_amount` = controvalore EUR nullable) e `transfers` (`from_currency`, `to_currency`, `to_amount` nullable = stessa valuta).

- [ ] **Step 5: Commit**

```bash
cd /home/lika44/Documenti/Python/Trackrs && git -C trackr diff --stat  # solo docs qui
git add supabase/migrations/20260717_multi_currency.sql docs/supabase-schema.md
git commit -m "feat: multi-currency schema migration"
```
(Nota: `supabase/` e `docs/` stanno nel repo root se versionati lì; altrimenti committare dove tracciati — verificare con `git status`.)

---

### Task 2: Setup Vitest

**Files:**
- Modify: `package.json` (trackr)
- Create: `src/utils/__tests__/smoke.test.ts` (rimosso nel Task 4)

- [ ] **Step 1: Installa**

```bash
cd /home/lika44/Documenti/Python/Trackrs/trackr && npm install -D vitest
```

- [ ] **Step 2: Script npm** — in `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 3: Smoke test**

```ts
// src/utils/__tests__/smoke.test.ts
import { describe, it, expect } from 'vitest';
describe('vitest', () => { it('runs', () => { expect(1 + 1).toBe(2); }); });
```

- [ ] **Step 4: Verifica** — `npm test` → Expected: 1 passed.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: add vitest"`

---

### Task 3: Servizio FX (`src/services/fx.ts`) — TDD

**Files:**
- Create: `src/services/fx.ts`
- Test: `src/services/__tests__/fx.test.ts`

**Interfaces:**
- Produces:
  - `SUPPORTED_CURRENCIES: readonly CurrencyCode[]`, `BASE_CURRENCY = 'EUR'`
  - `getRates(): Promise<Rates | null>` — `Rates = Record<string, number>` (unità estere per 1 EUR)
  - `getRateForDate(date: string, currency: CurrencyCode): Promise<number | null>`
  - `toBase(amount: number, currency: string, rates: Rates): number | null`
  - `computeBaseAmount(amount: number, currency: CurrencyCode, date: string): Promise<number | null>` — snapshot: `null` se EUR o tassi non disponibili

- [ ] **Step 1: Test falliti**

```ts
// src/services/__tests__/fx.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toBase, getRates, computeBaseAmount, FX_CACHE_KEY } from '../fx';

const RATES = { USD: 1.08, GBP: 0.85, CHF: 0.94, JPY: 170 };

describe('toBase', () => {
  it('converte USD in EUR', () => { expect(toBase(108, 'USD', RATES)).toBe(100); });
  it('EUR resta invariato', () => { expect(toBase(50, 'EUR', RATES)).toBe(50); });
  it('arrotonda a 2 decimali', () => { expect(toBase(10, 'JPY', RATES)).toBe(0.06); });
  it('valuta ignota -> null', () => { expect(toBase(10, 'XXX', RATES)).toBeNull(); });
});

describe('getRates', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('usa cache valida senza fetch', async () => {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ time: Date.now(), rates: RATES }));
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await getRates()).toEqual(RATES);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fetch se cache scaduta, salva cache', async () => {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ time: Date.now() - 25 * 3600 * 1000, rates: { USD: 9 } }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ rates: RATES })));
    expect(await getRates()).toEqual(RATES);
    expect(JSON.parse(localStorage.getItem(FX_CACHE_KEY)!).rates).toEqual(RATES);
  });

  it('fetch fallito -> cache stale', async () => {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ time: 0, rates: RATES }));
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await getRates()).toEqual(RATES);
  });

  it('nessuna cache + offline -> null', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await getRates()).toBeNull();
  });
});

describe('computeBaseAmount', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  it('EUR -> null (controvalore = amount)', async () => {
    expect(await computeBaseAmount(10, 'EUR', '2026-07-17')).toBeNull();
  });
  it('non-EUR con tasso storico', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ rates: { USD: 1.08 } })));
    expect(await computeBaseAmount(108, 'USD', '2026-07-01')).toBe(100);
  });
  it('offline senza cache -> null', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await computeBaseAmount(108, 'USD', '2026-07-01')).toBeNull();
  });
});
```

Nota ambiente: vitest gira in node — serve `localStorage`. In `package.json` niente jsdom: aggiungi in cima al test un mini-mock se assente:

```ts
if (typeof localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}
```

- [ ] **Step 2: Run** — `npm test` → Expected: FAIL (`Cannot find module '../fx'`).

- [ ] **Step 3: Implementazione**

```ts
// src/services/fx.ts
import type { CurrencyCode } from '../types';

export const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = ['EUR', 'USD', 'GBP', 'CHF', 'JPY'];
export const BASE_CURRENCY: CurrencyCode = 'EUR';
export const FX_CACHE_KEY = 'fx_rates_cache';
const FX_HIST_CACHE_KEY = 'fx_hist_cache';
const TTL = 24 * 60 * 60 * 1000;
const API = 'https://api.frankfurter.dev/v1';
const SYMBOLS = SUPPORTED_CURRENCIES.filter(c => c !== BASE_CURRENCY).join(',');

export type Rates = Record<string, number>; // unità estere per 1 EUR

const round2 = (n: number) => Math.round(n * 100) / 100;

function readCache(): { time: number; rates: Rates } | null {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function getRates(): Promise<Rates | null> {
  const cached = readCache();
  if (cached && Date.now() - cached.time < TTL) return cached.rates;
  try {
    const res = await fetch(`${API}/latest?base=${BASE_CURRENCY}&symbols=${SYMBOLS}`);
    if (!res.ok) throw new Error(`fx http ${res.status}`);
    const data = await res.json();
    const rates: Rates = data.rates;
    try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ time: Date.now(), rates })); } catch {}
    return rates;
  } catch {
    return cached ? cached.rates : null; // stale fallback
  }
}

export function toBase(amount: number, currency: string, rates: Rates): number | null {
  if (currency === BASE_CURRENCY) return round2(amount);
  const rate = rates[currency];
  if (!rate) return null;
  return round2(amount / rate);
}

export async function getRateForDate(date: string, currency: CurrencyCode): Promise<number | null> {
  if (currency === BASE_CURRENCY) return 1;
  try {
    const raw = localStorage.getItem(FX_HIST_CACHE_KEY);
    const hist: Record<string, Rates> = raw ? JSON.parse(raw) : {};
    if (hist[date]?.[currency]) return hist[date][currency];
    const res = await fetch(`${API}/${date}?base=${BASE_CURRENCY}&symbols=${SYMBOLS}`);
    if (!res.ok) throw new Error(`fx http ${res.status}`);
    const data = await res.json();
    hist[date] = data.rates;
    try { localStorage.setItem(FX_HIST_CACHE_KEY, JSON.stringify(hist)); } catch {}
    return data.rates[currency] ?? null;
  } catch {
    const rates = await getRates(); // fallback: tasso corrente/stale
    return rates?.[currency] ?? null;
  }
}

/** Snapshot base_amount per una transazione. null se EUR o tassi non disponibili. */
export async function computeBaseAmount(amount: number, currency: CurrencyCode, date: string): Promise<number | null> {
  if (currency === BASE_CURRENCY) return null;
  const today = new Date();
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const rate = date < localToday ? await getRateForDate(date, currency) : (await getRates())?.[currency] ?? null;
  if (!rate) return null;
  return round2(amount / rate);
}
```

(usare `localDateStr()` da `src/utils/date.ts` al posto del calcolo inline `localToday` — import esistente.)

- [ ] **Step 4: Run** — `npm test` → Expected: PASS tutti.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: fx service with rate cache and base-amount snapshot"`

---

### Task 4: Tipi + `computeBalances` (`src/utils/balances.ts`) — TDD

**Files:**
- Modify: `src/types/index.ts` (Account:195, AccountFormData:207, Transaction:74, Transfer:95, RecurringTransaction:~40-72, TransactionFormData:107)
- Create: `src/utils/balances.ts`
- Test: `src/utils/__tests__/balances.test.ts`
- Delete: `src/utils/__tests__/smoke.test.ts`

**Interfaces:**
- Consumes: `Rates`, `toBase`, `BASE_CURRENCY` dal Task 3.
- Produces:
  - `type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'CHF' | 'JPY'`
  - `interface AccountCurrency { id: number; account_id: number; currency: CurrencyCode; initial_balance: number }`
  - `Account += { currencies?: AccountCurrency[]; balances?: Record<string, number>; total_base?: number | null }` (opzionali per compat)
  - `Transaction += { currency: CurrencyCode; base_amount: number | null }`
  - `Transfer += { from_currency: CurrencyCode; to_currency: CurrencyCode; to_amount: number | null }`
  - `RecurringTransaction`: campo `currency?: string` ESISTE già (types/index.ts:68, usato per investment) — riusarlo, nessun nuovo campo.
  - `TransactionFormData += { currency?: CurrencyCode; to_currency?: CurrencyCode; to_amount?: number }`
  - `computeBalances(account: Pick<Account,'id'> & { currencies: AccountCurrency[] }, transactions: Transaction[], transfers: Transfer[]): Record<string, number>`
  - `totalBase(balances: Record<string, number>, rates: Rates | null): number | null`
  - `effectiveAmount(t: Pick<Transaction,'amount'|'currency'|'base_amount'>): number | null` — EUR→amount, altrimenti base_amount (anche null)

- [ ] **Step 1: Aggiorna i tipi** (additivi, campi nuovi opzionali dove il codice esistente costruisce oggetti; `currency`/`base_amount` su Transaction non-opzionali ma mappati in api.ts con default).

- [ ] **Step 2: Test falliti**

```ts
// src/utils/__tests__/balances.test.ts
import { describe, it, expect } from 'vitest';
import { computeBalances, totalBase, effectiveAmount } from '../balances';

const acc = { id: 1, currencies: [
  { id: 1, account_id: 1, currency: 'EUR' as const, initial_balance: 100 },
  { id: 2, account_id: 1, currency: 'USD' as const, initial_balance: 50 },
] };
const tx = (over: any) => ({ id: 1, account_id: 1, type: 'expense', category: '', amount: 10, date: '2026-07-01', currency: 'EUR', base_amount: null, ...over });
const tr = (over: any) => ({ id: 1, from_account_id: 1, to_account_id: 2, amount: 10, date: '2026-07-01', from_currency: 'EUR', to_currency: 'EUR', to_amount: null, ...over });

describe('computeBalances', () => {
  it('saldi iniziali per valuta', () => {
    expect(computeBalances(acc, [], [])).toEqual({ EUR: 100, USD: 50 });
  });
  it('income/expense nella valuta giusta', () => {
    const b = computeBalances(acc, [tx({ type: 'income', amount: 20, currency: 'USD' }), tx({ amount: 5 })], []);
    expect(b).toEqual({ EUR: 95, USD: 70 });
  });
  it('investment debita EUR', () => {
    expect(computeBalances(acc, [tx({ type: 'investment', amount: 30 })], []).EUR).toBe(70);
  });
  it('transfer out/in stessa valuta', () => {
    const b1 = computeBalances(acc, [], [tr({ amount: 40 })]);            // out da acc 1
    const b2 = computeBalances({ ...acc, id: 2 }, [], [tr({ amount: 40 })]); // in su acc 2 (solo EUR attiva? riga creata comunque)
    expect(b1.EUR).toBe(60);
    expect(b2.EUR).toBe(40 + (acc.currencies[0].initial_balance)); // vedi nota sotto: acc2 fixture con EUR init 100
  });
  it('cambio interno EUR->USD stesso conto', () => {
    const b = computeBalances(acc, [], [tr({ to_account_id: 1, from_currency: 'EUR', to_currency: 'USD', amount: 100, to_amount: 108 })]);
    expect(b).toEqual({ EUR: 0, USD: 158 });
  });
  it('transazioni di altri conti ignorate', () => {
    expect(computeBalances(acc, [tx({ account_id: 99, amount: 999 })], []).EUR).toBe(100);
  });
});

describe('totalBase', () => {
  it('converte e somma', () => {
    expect(totalBase({ EUR: 100, USD: 108 }, { USD: 1.08 })).toBe(200);
  });
  it('rates null con solo EUR -> somma EUR', () => {
    expect(totalBase({ EUR: 100, USD: 0 }, null)).toBe(100);
  });
  it('rates null con saldo estero != 0 -> null', () => {
    expect(totalBase({ EUR: 100, USD: 5 }, null)).toBeNull();
  });
});

describe('effectiveAmount', () => {
  it('EUR -> amount', () => { expect(effectiveAmount({ amount: 10, currency: 'EUR', base_amount: null } as any)).toBe(10); });
  it('non-EUR -> base_amount', () => { expect(effectiveAmount({ amount: 108, currency: 'USD', base_amount: 100 } as any)).toBe(100); });
  it('non-EUR senza snapshot -> null', () => { expect(effectiveAmount({ amount: 108, currency: 'USD', base_amount: null } as any)).toBeNull(); });
});
```

(Sistemare la fixture del test `transfer out/in`: definire `acc2 = { id: 2, currencies: [{ id: 3, account_id: 2, currency: 'EUR', initial_balance: 0 }] }` e attendersi `b2.EUR === 40`.)

- [ ] **Step 3: Run** — Expected: FAIL (`Cannot find module '../balances'`).

- [ ] **Step 4: Implementazione**

```ts
// src/utils/balances.ts
import type { Account, AccountCurrency, Transaction, Transfer } from '../types';
import { BASE_CURRENCY, toBase, type Rates } from '../services/fx';

type AccountLike = Pick<Account, 'id'> & { currencies: AccountCurrency[] };

export function computeBalances(account: AccountLike, transactions: Transaction[], transfers: Transfer[]): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const c of account.currencies) balances[c.currency] = c.initial_balance;

  for (const t of transactions) {
    if (t.account_id !== account.id) continue;
    const cur = t.currency ?? BASE_CURRENCY;
    if (balances[cur] === undefined) balances[cur] = 0;
    if (t.type === 'income') balances[cur] += t.amount;
    else balances[cur] -= t.amount; // expense + investment
  }

  for (const t of transfers) {
    if (t.from_account_id === account.id) {
      const cur = t.from_currency ?? BASE_CURRENCY;
      if (balances[cur] === undefined) balances[cur] = 0;
      balances[cur] -= t.amount;
    }
    if (t.to_account_id === account.id) {
      const cur = t.to_currency ?? BASE_CURRENCY;
      if (balances[cur] === undefined) balances[cur] = 0;
      balances[cur] += t.to_amount ?? t.amount;
    }
  }
  return balances;
}

export function totalBase(balances: Record<string, number>, rates: Rates | null): number | null {
  let total = 0;
  for (const [cur, value] of Object.entries(balances)) {
    if (cur === BASE_CURRENCY) { total += value; continue; }
    if (value === 0) continue;
    if (!rates) return null;
    const converted = toBase(value, cur, rates);
    if (converted === null) return null;
    total += converted;
  }
  return Math.round(total * 100) / 100;
}

export function effectiveAmount(t: Pick<Transaction, 'amount' | 'currency' | 'base_amount'>): number | null {
  if ((t.currency ?? BASE_CURRENCY) === BASE_CURRENCY) return t.amount;
  return t.base_amount ?? null;
}
```

- [ ] **Step 5: Run + tsc** — `npm test && npx tsc -b` → Expected: PASS, tsc pulito (sistemare ogni errore di tipo emerso dai campi nuovi: i costruttori di Transaction/Transfer in api.ts verranno aggiornati nel Task 5 — se tsc fallisce solo lì, procedere al Task 5 prima del commit congiunto).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: multi-currency types and pure balance computation"`

---

### Task 5: API layer (`src/services/api.ts`)

**Files:**
- Modify: `src/services/api.ts` — `mapAccount`, `mapTransaction`, `mapTransfer`, `mapRecurringTransaction`, `getAccounts`, `createAccount`, `createDefaultAccounts`, `createTransaction`, `updateTransaction`, `createTransfer`, `updateTransfer`, `createRecurringTransaction`, `processRecurringTransactions`; nuovi metodi CRUD valute.

**Interfaces:**
- Consumes: `computeBaseAmount` (Task 3), tipi (Task 4).
- Produces:
  - `getAccounts()` ritorna Account con `currencies: AccountCurrency[]` (nested select `'*, account_currencies(*)'`)
  - `addAccountCurrency(accountId: number, currency: CurrencyCode, initialBalance: number): Promise<AccountCurrency>`
  - `updateAccountCurrency(id: number, initialBalance: number): Promise<AccountCurrency>`
  - `removeAccountCurrency(id: number): Promise<void>` — throw `Error('currency_in_use')` se esistono movimenti; throw `Error('cannot_remove_eur')` se EUR
  - `createTransaction`/`updateTransaction` accettano `formData.currency` e scrivono `currency` + `base_amount`

- [ ] **Step 1: Nested select + map**

In `getAccounts()` sostituisci il select con `.select('*, account_currencies(*)')`. In `mapAccount(row)` aggiungi:

```ts
currencies: (row.account_currencies ?? []).map((c: any) => ({
  id: c.id, account_id: c.account_id, currency: c.currency, initial_balance: Number(c.initial_balance),
})),
```

In `mapTransaction`: `currency: row.currency ?? 'EUR', base_amount: row.base_amount != null ? Number(row.base_amount) : null`.
In `mapTransfer`: `from_currency: row.from_currency ?? 'EUR', to_currency: row.to_currency ?? 'EUR', to_amount: row.to_amount != null ? Number(row.to_amount) : null`.
In `mapRecurringTransaction`: `currency: row.currency ?? 'EUR'` (campo già esistente nel tipo).

- [ ] **Step 2: Creazione conto → riga EUR**

In `createAccount` e `createDefaultAccounts`, dopo l'insert del conto, insert riga EUR:

```ts
await supabase.from('account_currencies').insert({
  account_id: account.id,
  profile_id: this.getActiveProfileId(),
  currency: 'EUR',
  initial_balance: formData.initial_balance ?? 0,
});
```
e mantieni la scrittura di `accounts.initial_balance` (compat pfTrackr, valore duplicato della riga EUR).

- [ ] **Step 3: CRUD valute**

```ts
async addAccountCurrency(accountId: number, currency: CurrencyCode, initialBalance: number): Promise<AccountCurrency> {
  const { data, error } = await supabase.from('account_currencies')
    .insert({ account_id: accountId, profile_id: this.getActiveProfileId(), currency, initial_balance: initialBalance })
    .select().single();
  if (error) throw error;
  return { id: data.id, account_id: data.account_id, currency: data.currency, initial_balance: Number(data.initial_balance) };
}

async updateAccountCurrency(id: number, initialBalance: number): Promise<AccountCurrency> {
  const { data, error } = await supabase.from('account_currencies')
    .update({ initial_balance: initialBalance }).eq('id', id).select().single();
  if (error) throw error;
  return { id: data.id, account_id: data.account_id, currency: data.currency, initial_balance: Number(data.initial_balance) };
}

async removeAccountCurrency(id: number): Promise<void> {
  const { data: row, error: e0 } = await supabase.from('account_currencies').select('*').eq('id', id).single();
  if (e0) throw e0;
  if (row.currency === 'EUR') throw new Error('cannot_remove_eur');
  const [tx, trFrom, trTo] = await Promise.all([
    supabase.from('transactions').select('id', { count: 'exact', head: true }).eq('account_id', row.account_id).eq('currency', row.currency),
    supabase.from('transfers').select('id', { count: 'exact', head: true }).eq('from_account_id', row.account_id).eq('from_currency', row.currency),
    supabase.from('transfers').select('id', { count: 'exact', head: true }).eq('to_account_id', row.account_id).eq('to_currency', row.currency),
  ]);
  if ((tx.count ?? 0) + (trFrom.count ?? 0) + (trTo.count ?? 0) > 0) throw new Error('currency_in_use');
  const { error } = await supabase.from('account_currencies').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Snapshot su create/update transazione**

In `createTransaction`, prima dell'insert:

```ts
const currency = (formData.currency ?? 'EUR') as CurrencyCode;
const base_amount = await computeBaseAmount(formData.amount, currency, formData.date);
```
aggiungi `currency, base_amount` al payload insert. In `updateTransaction`: se `formData.amount`, `formData.currency` o `formData.date` presenti nel patch → ricalcola `base_amount` (leggendo i valori correnti per i campi mancanti) e includilo nel payload.

- [ ] **Step 5: Transfer**

In `createTransfer`/`updateTransfer` payload: `from_currency: formData.currency ?? 'EUR'`, `to_currency: formData.to_currency ?? formData.currency ?? 'EUR'`, `to_amount: formData.to_currency && formData.to_currency !== (formData.currency ?? 'EUR') ? formData.to_amount : null`.

- [ ] **Step 6: Recurring**

`createRecurringTransaction`: passa `currency` nel payload (campo colonna nuovo). In `processRecurringTransactions`, dove crea la transazione dalla regola: `currency: rule.currency ?? 'EUR'` e `base_amount: await computeBaseAmount(rule.amount, rule.currency ?? 'EUR', dueDate)`.

- [ ] **Step 7: Verifica** — `npx tsc -b` pulito, `npm test` PASS.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: multi-currency api layer"`

---

### Task 6: DataContext

**Files:**
- Modify: `src/contexts/DataContext.tsx` (useEffect saldi righe 121-146; fetchAllData; nuovo stato rates)

**Interfaces:**
- Consumes: `computeBalances`, `totalBase` (Task 4), `getRates` (Task 3), `apiService` (Task 5).
- Produces (via `useData()`): `fxRates: Rates | null`; Account arricchiti con `balances`, `total_base`, `current_balance = balances['EUR'] ?? 0`.

- [ ] **Step 1: Stato tassi** — `const [fxRates, setFxRates] = useState<Rates | null>(null);` caricato in `fetchAllData`: `getRates().then(setFxRates)` (non await — non bloccare il load).

- [ ] **Step 2: Sostituisci il ricalcolo saldi (righe 121-146)**

```ts
useEffect(() => {
  if (!isInitialized || accounts.length === 0) return;
  setAccounts(prev => prev.map(account => {
    const balances = computeBalances(
      { id: account.id, currencies: account.currencies ?? [{ id: -1, account_id: account.id, currency: 'EUR', initial_balance: account.initial_balance }] },
      transactions, transfers,
    );
    const total = totalBase(balances, fxRates);
    const eur = balances['EUR'] ?? 0;
    if (eur !== account.current_balance || total !== account.total_base
        || JSON.stringify(balances) !== JSON.stringify(account.balances)) {
      return { ...account, balances, current_balance: eur, total_base: total };
    }
    return account;
  }));
}, [transactions, transfers, isInitialized, fxRates]);
```

- [ ] **Step 3: Backfill lazy snapshot**

In `fetchAllData`, dopo il primo load (fire-and-forget):

```ts
(async () => {
  const missing = transactionsData.filter(t => t.currency !== 'EUR' && t.base_amount == null);
  for (const t of missing) {
    const ba = await computeBaseAmount(t.amount, t.currency, t.date);
    if (ba != null) await apiService.updateTransactionBaseAmount(t.id, ba);
  }
  if (missing.length) await refreshTransactions();
})().catch(() => {});
```
Aggiungi in api.ts il metodo mirato:
```ts
async updateTransactionBaseAmount(id: number, baseAmount: number): Promise<void> {
  const { error } = await supabase.from('transactions').update({ base_amount: baseAmount }).eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Esporta `fxRates`** nel context value e in `DataContextType`.

- [ ] **Step 5: Verifica** — `npx tsc -b && npm test && npm run build` puliti. Avvio manuale `npm run dev`: conti esistenti mostrano saldi identici a prima (riga EUR = vecchio initial_balance).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: per-currency balances in data context"`

---

### Task 7: AccountsPage — form valute, card, liquidità

**Files:**
- Modify: `src/pages/AccountsPage.tsx` (form modal ~38-120, card ~277-301, totalLiquidity:217)
- Modify: `src/locales/it.json`, `en.json`, `es.json` (chiavi nuove sotto `accounts.*`)

**Interfaces:**
- Consumes: `apiService.addAccountCurrency/updateAccountCurrency/removeAccountCurrency`, `account.balances/total_base/currencies`, `fxRates`, `SUPPORTED_CURRENCIES`.

- [ ] **Step 1: Chiavi i18n** (it mostrato; en/es tradotte coerenti):

```json
"currencies": "Valute",
"addCurrency": "Aggiungi valuta",
"currencyInUse": "Valuta con movimenti: impossibile rimuoverla",
"ratesUnavailable": "Tassi non disponibili",
"initialBalanceFor": "Saldo {{currency}}"
```

- [ ] **Step 2: Stato form** — estendi lo stato del modal con `currencyRows: { id?: number; currency: CurrencyCode; balance: number }[]` inizializzato da `account.currencies` + `account.balances` in `handleOpenModal` (per conto nuovo: `[{ currency: 'EUR', balance: 0 }]`).

- [ ] **Step 3: UI sezione Valute nel form** (dopo il campo saldo esistente, che diventa la riga EUR):

```tsx
<div>
  <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">{t('accounts.currencies')}</label>
  <div className="space-y-2">
    {currencyRows.map((row, i) => (
      <div key={row.currency} className="flex items-center gap-2">
        <span className="w-12 text-sm font-mono text-gray-500 dark:text-gray-400">{row.currency}</span>
        <input
          type="number" step="0.01" value={row.balance}
          onChange={e => setCurrencyRows(rows => rows.map((r, j) => j === i ? { ...r, balance: Number(e.target.value) } : r))}
          className="input-field flex-1"
        />
        {row.currency !== 'EUR' && (
          <button type="button" onClick={() => handleRemoveCurrency(i)}
            className="text-red-500 px-2 text-lg" aria-label="remove">×</button>
        )}
      </div>
    ))}
  </div>
  {availableCurrencies.length > 0 && (
    <div className="flex gap-2 mt-2">
      {availableCurrencies.map(c => (
        <button key={c} type="button"
          onClick={() => setCurrencyRows(rows => [...rows, { currency: c, balance: 0 }])}
          className="px-3 py-1.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-sm text-gray-500 dark:text-gray-400">
          + {c}
        </button>
      ))}
    </div>
  )}
</div>
```
con `const availableCurrencies = SUPPORTED_CURRENCIES.filter(c => !currencyRows.some(r => r.currency === c));`.

- [ ] **Step 4: Submit** — in `handleSubmit`, per ogni riga: la logica esistente riga 102-108 (saldo desiderato → initial ricalcolato) si applica **per valuta**: `newInitial = balanceValue - ((account.balances?.[cur] ?? 0) - (existingRow?.initial_balance ?? 0))`. Righe nuove → `addAccountCurrency`; righe esistenti con valore cambiato → `updateAccountCurrency`; righe rimosse in UI → `removeAccountCurrency` con `try/catch` su `currency_in_use` → alert `t('accounts.currencyInUse')`, riga ripristinata. La riga EUR continua ad aggiornare anche `accounts.initial_balance` (compat).

- [ ] **Step 5: Card conto** — sotto il saldo (righe ~295-301): se `account.currencies!.length > 1` mostra saldo principale `account.total_base` (fallback: saldo EUR + badge ⚠ se `total_base === null`) e chips:

```tsx
<div className="flex flex-wrap gap-1 mt-1 justify-end">
  {Object.entries(account.balances ?? {}).filter(([, v]) => v !== 0 || true).map(([cur, v]) => (
    <span key={cur} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
      {formatCurrency(v, cur)}
    </span>
  ))}
</div>
```

- [ ] **Step 6: Liquidità totale (riga 217)**

```ts
const totals = accounts.map(a => a.total_base);
const totalLiquidity = totals.some(t => t == null)
  ? null
  : totals.reduce((s: number, t) => s + (t as number), 0);
```
Se `null` → mostra somma dei soli saldi EUR + badge `t('accounts.ratesUnavailable')`.

- [ ] **Step 7: Verifica manuale** — `npm run dev`: aggiungi USD a un conto, saldo iniziale 50, card mostra chips. Rimozione USD senza movimenti ok, EUR non rimovibile (nessun bottone ×).

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: account currencies management ui"`

---

### Task 8: TransactionForm — picker valuta spesa/entrata

**Files:**
- Modify: `src/components/transactions/TransactionForm.tsx` (form tastierino riga ~906+, submit ~307, edit-reset)
- Modify: locales (`transactions.currency`)

**Interfaces:**
- Consumes: `selectedAccount.currencies`, `TransactionFormData.currency` (Task 4/5).
- Produces: submit include `currency` quando ≠ EUR.

- [ ] **Step 1: Stato** — `const [currency, setCurrency] = useState<CurrencyCode>('EUR');` reset a `'EUR'` quando cambia `selectedAccount` se la valuta corrente non è attiva sul nuovo conto (avviso inline `text-xs text-amber-600` sotto l'importo: `t('transactions.currencyReset')`).

- [ ] **Step 2: Picker** — accanto al display importo del tastierino (dove è mostrato il simbolo €): se `(selectedAccount?.currencies?.length ?? 1) > 1`, il simbolo diventa bottone che cicla le valute attive:

```tsx
<button type="button" onClick={() => {
  const active = selectedAccount!.currencies!.map(c => c.currency);
  setCurrency(cur => active[(active.indexOf(cur) + 1) % active.length]);
}} className="text-primary-500 font-semibold">
  {currSymbols[currency] ?? currency}
</button>
```
con `const currSymbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'Fr', JPY: '¥' };`. Conti mono-valuta: simbolo statico attuale, zero cambi.

- [ ] **Step 3: Submit** — includi `currency` nel `TransactionFormData` per expense/income (riga ~307 e percorso edit). In edit mode inizializza `currency` da `initialData.currency ?? 'EUR'`.

- [ ] **Step 4: Lista transazioni** — in `TransactionsPage.tsx`, dove formatta l'importo della riga, passa la valuta: `formatCurrency(t.amount, t.currency)`.

- [ ] **Step 5: Verifica manuale** — spesa USD su conto con USD attiva: saldo USD scende, EUR intatto; riga lista mostra `$`. Conto mono-valuta: form identico a prima.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: currency picker on transaction form"`

---

### Task 9: Transfer cross-currency

**Files:**
- Modify: `src/components/transactions/TransactionForm.tsx` (blocco transfer riga ~760+)
- Modify: locales (`transactions.youSend`, `transactions.youReceive`, `transactions.impliedRate`)

**Interfaces:**
- Consumes: `TransactionFormData.to_currency/to_amount` (Task 5), `getRates` (Task 3).
- Produces: transfer con valute per lato; cambio interno = from = to account.

- [ ] **Step 1: Stato** — `fromCurrency`, `toCurrency` (default `'EUR'`), `toAmountText: string`. Selettori valuta accanto ai picker conto from/to, visibili solo se il rispettivo conto ha >1 valuta. Permetti `to_account === from_account` SOLO se `fromCurrency !== toCurrency` (cambio interno) — oggi il form esclude lo stesso conto dalla destinazione: allenta il filtro quando il conto ha ≥2 valute.

- [ ] **Step 2: Campi importo** — se `fromCurrency === toCurrency`: campo unico (comportamento attuale). Altrimenti due campi:

```tsx
<div className="flex gap-2">
  <div className="flex-1">
    <label className="block text-xs text-gray-500 mb-1">{t('transactions.youSend')} ({fromCurrency})</label>
    {/* campo importo esistente */}
  </div>
  <div className="flex-1">
    <label className="block text-xs text-gray-500 mb-1">{t('transactions.youReceive')} ({toCurrency})</label>
    <input type="number" step="0.01" value={toAmountText}
      onChange={e => { setToAmountText(e.target.value); setToAmountTouched(true); }}
      className="input-field" />
  </div>
</div>
{impliedRate && (
  <div className="text-xs text-gray-400 text-center mt-1">1 {fromCurrency} = {impliedRate} {toCurrency}</div>
)}
```
Precompilazione: quando amount o coppia valute cambia e `!toAmountTouched`, calcola `toAmount` dai tassi frankfurter (`getRates()`: `amount * rates[toCurrency] / rates[fromCurrency]`, EUR=1). `impliedRate = (toAmount / amount).toFixed(4)` quando entrambi > 0.

- [ ] **Step 3: Validazione + submit** — se cross-currency: `to_amount > 0` obbligatorio (bottone disabilitato altrimenti). Submit passa `currency: fromCurrency, to_currency: toCurrency, to_amount`.

- [ ] **Step 4: Verifica manuale** — cambio interno €100→$108 su stesso conto: saldo EUR −100, USD +108, tasso implicito mostrato. Transfer EUR→EUR intatto.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: cross-currency transfers and internal exchange"`

---

### Task 10: Stats in EUR via effectiveAmount

**Files:**
- Modify: `src/services/api.ts` (`getTransactionStats`), `src/pages/StatsPage.tsx`, `src/pages/DashboardPage.tsx` (dove sommano `t.amount`)

**Interfaces:**
- Consumes: `effectiveAmount` (Task 4).

- [ ] **Step 1: Sostituisci ogni somma su `t.amount`** in stats/grafico bilancio con `effectiveAmount(t)`, saltando i `null` e contandoli:

```ts
let unconverted = 0;
const val = effectiveAmount(t);
if (val === null) { unconverted++; continue; }
```

- [ ] **Step 2: Nota UI** — se `unconverted > 0` mostra sotto i totali: `<div className="text-xs text-gray-400">{t('stats.unconverted', { count: unconverted })}</div>` (chiave: `"unconverted": "{{count}} non convertite"`).

- [ ] **Step 3: Verifica** — spesa $108 con snapshot 100: stats mese mostrano 100 € in più di spesa, non 108.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: stats use eur snapshot amounts"`

---

### Task 11: E2E + chiusura

**Files:**
- Create: script E2E in scratchpad (non versionato) secondo ricetta memoria `e2e-testing-setup`
- Modify: `vite.config.ts` (APP_PATCH + release notes), `docs/code-changes.md`, `CLAUDE.md` (sezione multi-currency breve)

- [ ] **Step 1: E2E playwright** (Supabase locale, utente test admin-confirmato, frankfurter mockato):

```
route '**api.frankfurter.dev/v1/**' -> { rates: { USD: 1.08, GBP: 0.85, CHF: 0.94, JPY: 170 } }
1. crea conto "Multi" -> aggiungi USD initial 0
2. spesa $108 -> card: chip USD -108, EUR intatto
3. cambio interno €100->$108 -> EUR -100, USD 0
4. transfer €50 verso altro conto EUR -> saldi coerenti
5. stats mese: spesa visibile come €100 (snapshot)
6. rimozione USD -> bloccata (movimenti)
7. cleanup: delete utente test via admin API
```
Expected: tutti i check passano, screenshot delle card.

- [ ] **Step 2: Gate finali** — `npm test && npx tsc -b && npm run build && npx eslint src` (eslint se deps riparate) → tutto verde.

- [ ] **Step 3: Docs + versione** — `APP_PATCH` +1 con release notes; entry in `docs/code-changes.md` (pattern esistente: data, titolo, elenco, Reason); paragrafo in `trackr/CLAUDE.md` sotto Architecture: valute per conto in `account_currencies`, saldi per valuta calcolati runtime, `base_amount` snapshot EUR, EUR non rimovibile.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: multi-currency release notes and docs"`

- [ ] **Step 5: NON pushare su main** — merge/push solo su richiesta esplicita dell'utente. Ricordare: migrazione da applicare su staging/prod PRIMA del deploy frontend.
