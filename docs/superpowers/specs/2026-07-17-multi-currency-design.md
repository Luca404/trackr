# Multi-currency accounts — design

Data: 2026-07-17
Stato: approvato a sezioni in sessione brainstorming, in attesa review finale

## Obiettivo

Un conto può avere più valute con saldi separati (stile Revolut). Copre spese, entrate, trasferimenti e cambi valuta. Le transazioni investment restano EUR-only (backlog #8 fuori scope). Base di conversione fissa EUR, predisposta per futura configurabilità.

Valute supportate v1: `EUR, USD, GBP, CHF, JPY` (lista curata estendibile, tutte coperte da frankfurter.dev).

## Decisioni chiave (dal brainstorming)

| Tema | Decisione |
|------|-----------|
| Aggregazione saldi | Totale convertito EUR + dettaglio per valuta (dashboard e card conto) |
| Attivazione valute | Esplicita nel form conto, con saldo iniziale opzionale per valuta |
| Cambi/transfer cross-currency | Entrambi gli importi espliciti (inviato + ricevuto); tasso implicito = cambio reale banca |
| Fonte tassi FX | frankfurter.dev (BCE), client-side, cache localStorage 24h |
| Stats | Controvalore EUR (`base_amount`) salvato alla creazione, snapshot immutabile |
| Valuta base | EUR fissa (costante interna, futura configurabilità) |
| Investment/pfTrackr | Fuori scope; investment debitano sempre il saldo EUR |

## 1. Schema DB (Supabase condiviso)

### Nuova tabella `account_currencies`

```sql
CREATE TABLE account_currencies (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (currency IN ('EUR','USD','GBP','CHF','JPY')),
  initial_balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(account_id, currency)
);
```

RLS: stesse policy delle altre tabelle finance — `is_profile_member(profile_id, auth.uid())` per SELECT/INSERT/UPDATE/DELETE.

### Colonne additive (tutte con default, zero breaking)

- `transactions.currency TEXT NOT NULL DEFAULT 'EUR'`
- `transactions.base_amount NUMERIC NULL` — controvalore EUR; `NULL` quando `currency='EUR'` (controvalore = `amount`)
- `transfers.from_currency TEXT NOT NULL DEFAULT 'EUR'`
- `transfers.to_currency TEXT NOT NULL DEFAULT 'EUR'`
- `transfers.to_amount NUMERIC NULL` — `NULL` = stessa valuta (importo = `amount`); valorizzato se cross-currency
- `recurring_transactions.currency TEXT NOT NULL DEFAULT 'EUR'`

### Semantica

- **Cambio interno** (EUR→USD nello stesso conto) = riga `transfers` con `from_account_id = to_account_id` e valute diverse. Nessuna tabella dedicata.
- **EUR sempre attiva e non rimovibile** su ogni conto. Creata automaticamente alla creazione del conto.

### Migrazione / backfill

```sql
INSERT INTO account_currencies (account_id, profile_id, currency, initial_balance)
SELECT id, profile_id, 'EUR', initial_balance FROM accounts
ON CONFLICT (account_id, currency) DO NOTHING;
```

- Idempotente. `accounts.initial_balance` resta come colonna deprecata (letta ancora da pfTrackr backend `/api/accounts`); fonte di verità = riga EUR di `account_currencies`.
- Migrazione additiva ⇒ pfTrackr backend continua a funzionare senza modifiche. Aggiornare `docs/supabase-schema.md`.
- Test su staging prima di produzione (regola repo).

## 2. Servizio FX (`src/services/fx.ts`)

Unico punto FX dell'app.

- `getRates(): Promise<Rates | null>` — `GET https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD,GBP,CHF,JPY`. Cache `localStorage['fx_rates_cache']` `{time, rates}`, TTL 24h.
- Cascata fallback: cache valida → rete → cache scaduta (stale) → `null`. Con `null` la UI degrada (saldi separati, nessun totale convertito, badge "tassi non disponibili"). FX non blocca mai l'app.
- `getRateForDate(date, currency)` — tasso storico `GET /v1/{date}?base=EUR&symbols=...` per transazioni retrodatate. Cache per data.
- `toBase(amount, currency, rates)` = `amount / rates[currency]` (frankfurter base EUR: unità estere per 1 EUR). Arrotondamento a 2 decimali.

### Snapshot `base_amount`

- Solo per `currency ≠ 'EUR'`.
- Creazione: tasso della **data della transazione** (storico se retrodatata, latest se oggi). Calcolato in `apiService.createTransaction`.
- Edit: ricalcolo solo se cambiano `amount`, `currency` o `date`.
- Offline/fetch fallito: usa cache stale; se nessun tasso → `base_amount = NULL`. **Backfill lazy**: a startup DataContext ripara le righe `currency≠'EUR' AND base_amount IS NULL` appena i tassi tornano.
- Transfer cross-currency: nessuno snapshot (non entrano in stats; il tasso reale è implicito in `amount`/`to_amount`).
- Recurring: transazione generata con currency della regola e tasso della `due_date`.

## 3. Tipi TS e logica saldi

```ts
export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'CHF' | 'JPY';

export interface AccountCurrency {          // riga DB
  id: number; account_id: number;
  currency: CurrencyCode; initial_balance: number;
}

export interface Account {                  // esteso
  // ...campi attuali
  currencies: AccountCurrency[];            // nested select
  balances: Record<CurrencyCode, number>;   // runtime
  current_balance: number;                  // = balances.EUR (compat investment/codice esistente)
  total_base: number | null;                // Σ convertita; null se tassi mancanti
}

// Transaction  += { currency: CurrencyCode; base_amount: number | null }
// Transfer     += { from_currency; to_currency; to_amount: number | null }
// RecurringTransaction += { currency: CurrencyCode }
```

- Fetch: `supabase.from('accounts').select('*, account_currencies(*)')` — una query.
- Calcolo saldo per (conto, valuta), estratto in **`src/utils/balances.ts` come funzione pura** `computeBalances(...)`:

```
balances[cur] = initial_balance(cur)
  + Σ income(cur) − Σ expense(cur) − Σ investment(EUR)
  − Σ transfer out (from_currency = cur): amount
  + Σ transfer in  (to_currency  = cur): to_amount ?? amount
```

- `total_base` = Σ `toBase(balances[cur], cur, rates)`; `null` se rates `null` e qualche saldo non-EUR ≠ 0.
- `effectiveAmount(tx)` = `base_amount ?? amount` per stats/grafici.
- API nuove in `apiService`: `addAccountCurrency`, `updateAccountCurrency` (solo initial_balance), `removeAccountCurrency`.
- Rimozione valuta bloccata se esistono transazioni o transfer legs (from o to) in quella valuta sul conto. Saldo iniziale ≠ 0 senza movimenti → rimovibile.
- Investment: `currency='EUR'` forzata, nessun picker.

## 4. UI

- **Form conto**: sezione "Valute" — lista attive con saldo iniziale editabile, tile "+ valuta" (picker lista curata), rimozione con guard. EUR fissa.
- **Card conto**: solo-EUR → identica a oggi. Multi-valuta → saldo principale = totale convertito, chips per valuta sotto (`€ 1.200 · $ 300`).
- **Liquidità totale (header/dashboard)**: totale convertito EUR; senza tassi → somma EUR + chips estere + badge ⚠.
- **TransactionForm (spesa/entrata)**: picker valuta solo se il conto selezionato ha >1 valuta attiva — simbolo tappabile accanto all'importo. Default EUR. Conti mono-valuta: form identico a oggi.
- **Transfer**: valuta selezionabile per lato (solo valute attive del rispettivo conto). Valute uguali → un importo (come oggi). Diverse → campi "Invii"/"Ricevi", "Ricevi" precompilato dal tasso frankfurter ma modificabile, tasso implicito mostrato (`1 € = 1.082 $`). Cambio interno = stesso form con from = to.
- **Lista transazioni**: importo nella valuta originale col suo simbolo (`-$ 20.00`), nessun doppio importo.
- **Stats/Recap/grafico**: invariati visivamente, tutto in EUR via `effectiveAmount`. Righe con `base_amount NULL` escluse dai totali con nota discreta "N non convertite".
- **Settings**: nessun cambio (base fissa).

## 5. Edge case ed error handling

- Edit transazione che cambia conto: valuta non attiva sul nuovo conto → reset a EUR con avviso inline.
- Kakebo import: intatto (tutto EUR via default DB).
- JPY: v1 mantiene 2 decimali ovunque (limite noto, accettato).
- FX mai bloccante sul submit (cascata → `NULL` + backfill lazy).
- Validazioni: `to_amount > 0` se cross-currency; picker limita alle valute attive; doppio check in `apiService`.
- Una sola conversione al display (mai conversioni in cascata).

## 6. Testing

- **Vitest** (nuovo in trackr, primo passo del backlog #6): unit su `computeBalances` (multi-valuta, cross-currency transfer, cambio interno, initial_balance) e su `fx.toBase`/logica snapshot.
- **E2E playwright** contro dev server + Supabase locale (ricetta in memoria progetto): attiva USD su conto → spesa USD → verifica chips saldi → cambio interno EUR→USD con importi espliciti → verifica saldi → stats con snapshot. Frankfurter mockato via `page.route` per determinismo.
- Gate finali: `tsc -b && vite build`, lint.

## Fuori scope (esplicito)

- Ordini investment in valuta ≠ EUR (backlog #8) — costruirà sopra queste fondamenta.
- Valuta base configurabile.
- Tassi manuali per-transazione su spese/entrate (solo transfer hanno importi espliciti doppi).
- pfTrackr frontend/backend: nessuna modifica.
