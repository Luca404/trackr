# Trackr PWA — CLAUDE.md

PWA online-first per la gestione di spese personali. React 18 + TypeScript + Vite + Tailwind + Supabase.

## Stack
- **Framework**: React 18 + TypeScript
- **Build**: Vite + vite-plugin-pwa (service worker + manifest) — richiede Node 20+
- **Styling**: Tailwind CSS (mobile-first, dark mode via `dark:` prefix)
- **DB + Auth**: Supabase (`@supabase/supabase-js`) — PostgreSQL hosted + Auth email/password + RLS
- **Routing**: React Router

## Comandi
```bash
npm run dev       # Dev server → http://localhost:5174
npm run build     # Build produzione → dist/ (richiede Node 20+)
npm run preview   # Preview build
npm run lint      # ESLint
```

## Env vars
```env
VITE_SUPABASE_URL=https://...   # Supabase project URL
VITE_SUPABASE_ANON_KEY=...      # Supabase anon public key
VITE_PF_BACKEND_URL=https://... # Portfolio-tracker backend (Railway) — default: hardcoded Railway URL in PortfoliosPage.tsx
```
Credenziali reali in `.env.local` (gitignored).

## Struttura
```
src/
├── components/
│   ├── common/        # Modal, SkeletonLoader, ConfirmDialog, PeriodSelector, DateRangePicker
│   ├── layout/        # Navigazione, layout shell
│   └── transactions/  # TransactionForm e componenti correlati
├── contexts/
│   ├── AuthContext.tsx
│   └── DataContext.tsx   # Cache in-memory + CRUD per accounts/categories/transactions
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── TransactionsPage.tsx
│   ├── StatsPage.tsx
│   ├── CategoriesPage.tsx
│   ├── AccountsPage.tsx
│   ├── PortfoliosPage.tsx
│   └── SettingsPage.tsx   # Export backup JSON + logout
├── services/
│   ├── api.ts             # ApiService — CRUD diretto su Supabase
│   └── supabase.ts        # Client Supabase (createClient)
└── types/index.ts         # Tutte le interfacce TypeScript
```

## Architettura dati (online-first)

### Layer chain
```
Componente / Page
    → apiService (src/services/api.ts)
        → supabase (src/services/supabase.ts)  ← Supabase PostgreSQL
```

### Flusso dati
- **Lettura**: `DataContext` carica tutto all'avvio da Supabase → tieni in memoria React state
- **Scrittura**: pagine chiamano `apiService.create/update/delete*()` → poi aggiornano DataContext ottimisticamente
- **Nessuna persistenza locale**: dati sempre freschi da Supabase; no IndexedDB, no localStorage cache

## Tipi principali (src/types/index.ts)

```typescript
type TransactionType = 'expense' | 'income' | 'investment' | 'transfer'

interface Transaction {
  id: number            // ID Supabase (SERIAL)
  account_id: number
  type: TransactionType  // 'transfer' non viene più usato qui — i trasferimenti hanno tabella dedicata
  category: string       // nome categoria (stringa libera)
  subcategory?: string
  amount: number
  description?: string
  date: string           // formato ISO: YYYY-MM-DD
  created_at?: string
  updated_at?: string
  ticker?: string        // solo per investment
  quantity?: number
  price?: number
}

interface Transfer {
  id: number
  from_account_id: number
  to_account_id: number
  amount: number
  description?: string
  date: string           // formato ISO: YYYY-MM-DD
  created_at?: string
  updated_at?: string
}

interface Category {
  id: number
  name: string
  icon: string           // emoji
  category_type?: 'expense' | 'income' | null   // 'investment' rimosso
  subcategories: Subcategory[]
}

interface Account {
  id: number
  name: string
  icon: string
  initial_balance: number
  current_balance?: number  // calcolato da DataContext, non salvato in DB
  is_favorite?: boolean
}

interface Portfolio {
  id: number
  name: string
  description?: string
  initial_capital: number
  reference_currency: string
  risk_free_source: string
  market_benchmark: string
  created_at: string
  // category_id rimosso — portfolios non sono più collegati a categorie
  total_value?: number   // dal backend Railway
  total_cost?: number
  total_gain_loss?: number
  total_gain_loss_pct?: number
}
```

## Profili multipli e condivisibili

Ogni account (email) può avere più profili, ciascuno con dati separati (conti, categorie, transazioni, trasferimenti, portafogli). Un profilo può essere condiviso con altri utenti registrati come `editor` (lettura+scrittura) o `viewer` (sola lettura).

### Struttura DB

- `profiles`: `id UUID`, `user_id UUID` (FK auth.users), `name TEXT`. Il profilo principale ha `id = auth.uid()`.
- `profile_members`: `(profile_id, user_id)` PK, `role` ('owner'|'editor'|'viewer'), `email`, `joined_at`. **Unica source-of-truth per i permessi**.
- `profile_share_invitations`: `id UUID`, `profile_id`, `invited_email`, `invited_by`, `role`, `status` ('pending'|'accepted'|'rejected'|'cancelled'), `expires_at` (7 giorni).
- Tutte le tabelle dati hanno `profile_id UUID` (FK → `profiles.id`, ON DELETE CASCADE).

### RLS e helper functions

- `is_profile_member(profile_id, user_id)` — SECURITY DEFINER, usata da tutte le policy RLS.
- `is_profile_owner(profile_id, user_id)` — SECURITY DEFINER.
- `profiles_select` policy: accesso a owner, membri, e invitati pending (per mostrare il nome del profilo nella notifica).
- Tutte le tabelle dati: SELECT via `is_profile_member`; INSERT/UPDATE/DELETE richiedono `role IN ('owner', 'editor')`.

### RPC server-side

- `get_my_profiles()` — SECURITY DEFINER: repair membership + crea profilo se mancante + restituisce `(id, uid, name, role, created_at, member_count)`. Unico punto di ingresso all'avvio. **`uid` è `user_id` rinominato per evitare ambiguità PL/pgSQL in RETURNS TABLE.**
- `create_profile_invitation(p_profile_id, p_email, p_role)` — rate-limited (10/h), anti-enumeration (silenzio se email non esiste).
- `accept_profile_invitation(p_invitation_id)` — atomico: crea membership + aggiorna status.
- `repair_own_membership()` — tenuta come safety net, superseded da `get_my_profiles()`.

### Logica client

- Il profilo attivo è in `localStorage['activeProfileId']` e in `apiService._activeProfileId`.
- `apiService.setActiveProfile(id)` va chiamato prima di qualsiasi query — lo fa `DataContext.fetchAllData` all'avvio.
- `DataContext` espone `userProfiles`, `activeProfile`, `pendingInvitations`, e le actions: `switchProfile`, `createUserProfile`, `updateUserProfile`, `deleteUserProfile`, `acceptInvitation`, `rejectInvitation`, `leaveProfile`.
- Il profilo principale (`id = user_id`) non è eliminabile (RLS blocca DELETE dove `id = user_id`).
- Al cambio profilo, `pf_summaries_cache` in localStorage viene rimosso per forzare il reload dei dati portafoglio.

### UI

- `SettingsPage`: switch, rinomina, aggiungi, elimina profili. Per i profili `owner`: sezione espandibile con lista membri, form invito (email + ruolo). Numero di membri accanto all'icona 👥. Per i profili non-owner: bottone "Lascia profilo".
- `Layout.tsx`: badge notifiche include `pendingInvitations.length`. Panel notifiche mostra card di invito con Accept/Reject. Banner viewer in alto (`activeProfile.role === 'viewer'`).
- Pagine con scrittura (`TransactionsPage`, `AccountsPage`, `CategoriesPage`): pulsanti add/edit/delete nascosti se `activeProfile.role === 'viewer'`.

### Note per il merge in main

1. Aggiornare il trigger `on_auth_user_created` in Supabase per inserire anche in `profile_members` — così `repair_own_membership()` non serve più per i nuovi utenti.
2. Verificare che la vecchia policy `profiles_select` sia stata droppata e sostituita correttamente.

## Contesti React

### DataContext (`src/contexts/DataContext.tsx`)
- Tiene in memoria accounts, categories, transactions, transfers, portfolios (cache in-memory, no localStorage)
- Si inizializza alla detection della sessione Supabase via `onAuthStateChange`
- Espone `refreshAll()`, `refreshTransactions(startDate?, endDate?)`, `refreshTransfers()`, `refreshPortfolios()`, e CRUD ottimistico per tutti i tipi
- Espone `userProfiles`, `activeProfile`, `pendingInvitations`, `switchProfile(profile)`, `createUserProfile(name)`, `updateUserProfile(id, name)`, `deleteUserProfile(id)`, `acceptInvitation(id)`, `rejectInvitation(id)`, `leaveProfile(id)`
- All'avvio carica i profili, risolve il profilo attivo da localStorage, chiama `apiService.setActiveProfile()` prima di caricare i dati
- Ricalcola `current_balance` degli account via `useEffect` ogni volta che cambiano transactions o transfers:
  - transactions: income +, expense/investment -
  - transfers: `from_account_id` -, `to_account_id` +
- Crea categorie default solo se mancano expense o income (NON investment — rimosse)

### AuthContext (`src/contexts/AuthContext.tsx`)
- Gestisce login/logout tramite **Supabase Auth** (email + password)
- Ascolta `onAuthStateChange` per mantenere la sessione aggiornata
- Token JWT Supabase salvato in `localStorage` come `authToken` e `access_token`
- `logout()` è async (chiama `supabase.auth.signOut()`)

### SettingsContext (`src/contexts/SettingsContext.tsx`)
- Espone `formatCurrency(amount, currency?)` tramite `Intl.NumberFormat` con locale basata su `numberFormat`
- `numberFormat: 'dot' | 'comma'` persistito in `localStorage['numberFormat']`; default `'dot'` (inglese)
- locale: `'en-US'` per dot, `'it-IT'` per comma
- Usato in tutte le pagine per formattare importi; non usare `toLocaleString` hardcoded

### i18n (`src/i18n.ts` + `src/locales/en.json` + `src/locales/it.json`)
- Setup con `react-i18next`; lingua default `en`, salvata in `localStorage['lang']`
- Tutti i componenti usano `useTranslation()` → `t('namespace.key')`
- Selettore lingua in SettingsPage; selettore formato numeri in SettingsPage
- **Attenzione**: evitare `const t = ...` come nome variabile locale nei componenti che importano `useTranslation` (conflitto con il nome della funzione `t`)

## Supabase DB (schema unificato con portfolio-tracker)
Tabelle: `profiles`, `profile_members`, `profile_share_invitations`, `accounts`, `categories`, `subcategories`, `transactions`, `recurring_transactions`, `transfers`, `portfolios`, `orders`
- RLS abilitato su tutte le tabelle. Dopo la migrazione `shared_profiles_migration.sql` le policy si basano su `is_profile_member()` invece di `user_id = auth.uid()`
- Trigger `on_auth_user_created` crea automaticamente il profilo al signup (TODO: aggiornare per inserire anche in `profile_members`)
- `current_balance` degli account non è una colonna DB — calcolato in DataContext
- `transfers` ha colonne: `from_account_id`, `to_account_id`, `amount`, `description`, `date` — **non** usa la tabella `transactions`
- `portfolios`: la colonna `category_id` è stata rimossa dal DB
- `categories`: le righe con `category_type = 'investment'` sono state eliminate dal DB; `category_type` può essere solo `'expense'`, `'income'`, o `null`

## Default data
- Se `getAccounts()` ritorna vuoto → crea "Conto Corrente" e "Contanti" per l'utente
- Se `getCategories()` ritorna vuoto per expense o income → crea categorie predefinite (expense + income + null, NON investment)
- Logica in `fetchAllData` di DataContext: chiama `apiService.createDefaultAccounts()` / `apiService.createDefaultCategories(existing)` se mancano

## Pattern UI
- **Mobile-first**: layout pensato per touch, bottoni grandi, bottom nav
- **Dark mode**: tutte le classi usano `dark:` prefix di Tailwind
- **Card**: classe utility `.card` definita in `index.css`
- **Input**: usare sempre la classe utility `.input-field` definita in `index.css` — **mai** `input` da solo (non esiste come utility). Per input inline in layout flex usare le stesse classi Tailwind ma con `flex-1` al posto di `w-full`.
- **Aggiunta elementi**: no FAB — ogni lista ha una riga/tile con cerchio "+" in fondo
- **Icone categorie**: emoji, con suggerimento automatico basato su keyword italiane (vedi `CategoriesPage.tsx`)
- **Swipe navigazione**: `useSwipeNavigation` gestisce lo swipe orizzontale tra pagine. Lo swipe cambia sempre pagina (non ci sono più tab-swipe). Ai bordi (prima/ultima pagina) non mostra l'animazione di trascinamento e non naviga in quella direzione.
- **Skeleton loading**: ogni pagina ha il proprio skeleton in `SkeletonLoader.tsx` (`TransactionsSkeleton`, `AccountsSkeleton`, `CategoriesSkeleton`, `StatsSkeleton`, `DashboardSkeleton`, `PortfoliosSkeleton`). Viene mostrato dentro `<Layout>` così header e nav restano visibili durante il caricamento.
- **Refresh**: pulsante rotella in header (accanto alle impostazioni) chiama `DataContext.refreshAll()` con `animate-spin` durante il fetch.
- **Versioning**: la versione `MAJOR.MINOR.PATCH` è mostrata nell'header accanto a "Trackr" (`v1.0.1`). Tutte e tre le costanti sono hardcoded in `vite.config.ts` (`APP_MAJOR`, `APP_MINOR`, `APP_PATCH`). **`APP_PATCH` va incrementato manualmente ad ogni commit** (attualmente `1`). Il commit message è iniettato come `__LAST_COMMIT_MSG__` e incluso in `public/version.json` per il banner di aggiornamento.
- **Update banner**: `useRegisterSW` (da `virtual:pwa-register/react`) rileva quando un nuovo SW è in attesa (`needRefresh`). Mostra un banner fisso sopra la bottom nav con il testo dell'ultimo commit e un bottone "Ricarica" che chiama `updateServiceWorker(true)`. Il `registerType` di VitePWA è `'prompt'` (non `autoUpdate`) per controllare manualmente l'aggiornamento.

## Backup locale JSON
Formato esportato da `SettingsPage.tsx`:
```json
{
  "version": 1,
  "exportDate": "ISO string",
  "data": { "transactions": [...], "categories": [...], "accounts": [...], "portfolios": [...] }
}
```

## Comportamenti UX notevoli
- **Layout shell**: `Layout.tsx` usa `height: 100dvh` + `overflow: hidden` sul wrapper; solo `<main>` ha `overflow-y: auto` + `overscroll-behavior: none` per bloccare bounce e impedire che l'header scorra via. Header e bottom nav sono sempre visibili.

- **Liquidità totale sticky** (`AccountsPage`): card con `position: sticky; top: 0` dentro il main scrollabile. Ha un gradient fade (`bg-gradient-to-b`) sotto di sé per ammorbidire il passaggio delle card. Stato `hideBalances` persistito in `localStorage`.

- **Ordinamento**: conti ordinati per saldo decrescente; categorie ordinate per `total_amount` decrescente nel periodo selezionato.

- **Conto preferito**: non è deselezionabile — click sulla stellina attiva funziona solo per cambiare preferito a un altro conto. `handleToggleFavorite` in `AccountsPage.tsx` persiste nel DB sia il nuovo preferito che la rimozione dai vecchi (con `Promise.all`).

- **Swipe navigation**: `useSwipeNavigation` hook gestisce lo swipe orizzontale tra pagine della bottom nav. Quando è aperto un modal (`[data-no-swipe]` nel DOM) dispatcha `trackr:swipe-back` invece di navigare.

- **Modal back gesture** (`Modal.tsx`): ogni Modal aperto pusha un entry in `window.history` (`{ modalBackIntercept: true }`). Uno stack module-level (`_stack`) gestisce modal annidati — solo il top risponde al `popstate` (back nativo del telefono) e a `trackr:swipe-back`. Chiusura programmatica → `history.back()` per ripulire lo stato pushato. `_activate()` resetta il contatore ad ogni nuova sessione per prevenire drift.

- **`registerBackHandler`** (esportato da `Modal.tsx`): registra un handler back per stati interni a un form (es. `selectedCategory` in `TransactionForm`, `selectedPortfolio` per investment) senza usare un Modal vero. Restituisce un cleanup da passare a `useEffect`.

- **Portfolio summaries cache** (`PortfoliosPage`): i valori totali dei portafogli vengono cachati in `localStorage['pf_summaries_cache']` con TTL 24h. Se tutti i valori sono 0 (probabile errore di fetch dal backend), il TTL è ridotto a 5 minuti per forzare il retry. Al cambio profilo la cache viene rimossa.

## Transazioni ricorrenti
- Tabella `recurring_transactions`: `frequency` (`weekly`/`monthly`/`yearly`), `start_date`, `next_due_date`
- `transactions.recurring_id` (FK nullable) lega una transazione alla sua regola
- All'avvio dell'app, `DataContext.fetchAllData` chiama `apiService.processRecurringTransactions()` che crea tutte le transazioni scadute (catchup multi-periodo) e aggiorna `next_due_date`
- Creazione: `TransactionsPage.handleCreateTransaction` crea prima la regola, poi la prima transazione con `recurring_id`
- Eliminazione: TransactionForm mostra due opzioni se `isRecurring=true` — "Solo questa" (elimina la transazione) o "Elimina regola" (cancella la regola, le transazioni già create restano)
- Il campo `recurrence` in `TransactionFormData` è UI-only; viene strippato prima dell'insert in `api.createTransaction`
- 🔄 badge visibile nella lista transazioni e nel form

## Note importanti
- Le categorie nel TransactionForm vengono filtrate per `category_type === currentType` — le categorie con `category_type = null` non appaiono in nessun tab
- **Categorie investment rimosse**: non esistono più categorie di tipo `investment`. `CategoriesPage` mostra solo expense e income. `DEFAULT_CATEGORIES` non include più investment.
- **Flusso transazione investimento**:
  1. Utente seleziona tab "Investimento"
  2. Viene mostrata una griglia di selezione portafoglio (come la griglia categorie per expense/income). Se non ci sono portafogli, mostra avviso con link a PortfoliosPage.
  3. Dopo aver selezionato il portafoglio, appare il form con: portafoglio selezionato + conto, selettore ETF/Stock/Bond, ticker/ISIN, quantità, prezzo, commissioni → totale calcolato automaticamente.
  4. La `category` della transazione viene impostata al nome del portafoglio selezionato.
  5. Back gesture (swipe/tasto back) nella schermata del form ritorna alla griglia portafogli.
- **Instrument type** (solo per investment): selector Stock / ETF / Bond. Cambia il comportamento del symbol search:
  - **Stock/ETF**: cerca tramite backend `/symbols/search?instrument_type=stock|etf`; dropdown con risultati
  - **Bond**: cerca prima in `bondCache` locale (ISIN prefix o substring su name/issuer); dropdown con nome/emittente/scadenza/cedola; se non trovato mostra "Cerca obbligazione" (chiama `/symbols/bond-lookup?isin=...`)
- **Bond cache**: caricata all'avvio della sessione dal backend (`/symbols/bonds`), tenuta in `bondCache` state con backup in `sessionStorage['bondCache']`. All'on-demand lookup il bond trovato viene aggiunto alla cache locale e a sessionStorage.
- **Info panel**: dopo la selezione di un asset (stock/ETF/bond) compare un card `bg-gray-50 dark:bg-gray-800` con: nome, exchange, valuta, TER, e per i bond: cedola, scadenza, YTM lordo/netto, duration.
- **Prezzo**: sempre diretto in valuta (es. €/unit) per tutti i tipi inclusi i bond — formula `qty × price + commissione`. Non più percentuale del nominale.
- **Campi order**: quando si crea una transazione investment, vengono salvati su `orders`: `isin`, `instrument_name`, `exchange`, `instrument_type`, `ter`. Questi campi sono in `TransactionFormData` ma vengono strippati prima dell'insert in `transactions` e passati a `createOrder`.
- **Delete transazione investment**: l'ordine va eliminato **prima** della transazione (`deleteOrderByTransactionId` → poi `deleteTransaction`), perché la FK `orders.transaction_id → transactions.id` è `ON DELETE SET NULL` — se si elimina prima la transazione, il campo viene azzerato e l'ordine non è più trovabile.
- Per `type=transfer`, il TransactionForm mostra un form Da→A con tastierino. Al submit chiama `apiService.createTransfer()` (tabella `transfers`) — nessuna riga viene inserita in `transactions`.
- `TransactionsPage` mostra una lista unificata: `transactions` + `transfers` merged e ordinati per data. I trasferimenti mostrano "Conto A → Conto B" come sottotitolo.
- `account_id` nelle transazioni è un `number` (ID Supabase), non una stringa
- `current_balance` degli account viene calcolato in DataContext sommando `initial_balance` + transactions + transfers — non è mai scritto in Supabase
- `updateAccount` ignora il campo `current_balance` nel payload (non è una colonna DB)
- Non c'è Redux né Zustand: tutto lo stato globale è nei Context

## Portfolio backend (Railway)
- Backend Python/FastAPI su Railway: `VITE_PF_BACKEND_URL`
- SQLite usata solo come price cache (ETF/stock via JustETF/yfinance) — è ephemeral su Railway, si azzera ad ogni redeploy
- `PortfoliosPage` chiama `GET /portfolios` (non più per-portfolio `/summary`) per ottenere tutti i valori in una sola request e scaldare la price cache in una volta
- Se la SQLite price cache è fredda (primo avvio post-redeploy), JustETF/yfinance fetchano i prezzi live. Se falliscono, `total_value` è 0 e viene cachato per soli 5min (invece di 24h)
- `GET /portfolios` del backend filtra per `user_id` (dal JWT), non per `profile_id`

## Deployment
- **Hosting**: Vercel — deploy automatico ad ogni `git push main`
- **Repo**: github.com/Luca404/trackr

## Problemi noti
- **Sessione zombie dopo cancellazione utente dal DB**: se un utente viene cancellato direttamente da Supabase (auth.users + profiles), l'app può non fare logout automatico perché il JWT locale è ancora valido e `supabase.auth.getUser()` può restituire ancora l'utente dalla cache. Non è un problema reale in produzione (gli utenti non vengono cancellati direttamente dal DB). Workaround: fare logout manuale dall'app, o cancellare i dati del browser.
- **Barra autofill Chrome Android**: quando si apre la tastiera su un input, Chrome mostra una barra nera con icone password/carta/indirizzo. Non è risolvibile via HTML/CSS — è UI nativa del browser (`KeyboardAccessoryView`). Chrome ignora intenzionalmente `autoComplete="off"` per questa funzione. Soluzione solo lato utente: disabilitare autofill nelle impostazioni Chrome.

## TODO funzionalità
- [ ] **Eliminazione categoria con transazioni associate**: ora eliminare una categoria lascia le transazioni con `category` = nome stringa orfano. Possibili approcci: (a) bloccare l'eliminazione se ci sono transazioni associate mostrando il conteggio; (b) chiedere all'utente a quale categoria spostare le transazioni prima di eliminare; (c) assegnare automaticamente le transazioni a una categoria "Senza categoria". Stessa problematica per le sottocategorie. Da implementare in `confirmDeleteCategory` / `confirmDeleteSubcategory` in `CategoriesPage.tsx`.
- [ ] **Logo app**: rifinire il logo (icon-512.png, icon-192.png) e aggiornare icon.svg coerentemente — logo attuale provvisorio generato con AI
- [ ] **Lingua categorie default**: le categorie predefinite vengono create usando `i18n.language` al momento del primo login. Se l'utente ha impostato la lingua dell'app diversa da quella del browser (o non l'ha ancora impostata), le categorie potrebbero essere create nella lingua sbagliata. Verificare il flusso: `DataContext.fetchAllData` → `lang = i18n.language?.slice(0,2)` → `apiService.createDefaultCategories(lang)`. Possibile fix: mostrare un dialog alla prima apertura che chiede la lingua prima di creare i default, oppure ricreare le categorie default (rinominandole) quando l'utente cambia lingua.
- [x] **Test valore portfolio con nuovo account**: fix applicata. Il bug era che Railway SQLite price cache è cold al primo accesso → `total_value=0` ma `total_cost>0` → prima veniva cachato per 5min con TTL_EMPTY. Fix: se `total_value=0` ma `total_cost>0` (price fetch fallito), il risultato NON viene cachato → il prossimo accesso riprova subito. Aggiunto anche `positions_count` alla risposta `GET /portfolios` del backend.
- [ ] **pfTracker — collegamento conto**: aggiungere in pfTracker la possibilità di scegliere un conto bankario quando si registra un ordine, in modo da creare automaticamente anche una transazione `investment` in trackr che scala il saldo del conto. Questo creerebbe il collegamento bidirezionale ordine↔transazione (attualmente solo trackr→pfTracker).
- [ ] **Bottone aggiunta portafoglio**: rivedere UX del pulsante "+" per aggiungere un nuovo portafoglio in PortfoliosPage (attualmente è una card dashed in fondo alla lista — valutare se spostarlo nell'header o cambiare stile).


bug: 
Come gestisco le transazioni quando cancello un portafoglio?

Modificare Trackr per renderlo più usabile su pc

BUG grafico strano, difficile da replicare, in cui se scorri in un determinato modo, forse mentre switchi pagina, ti fa scorrere anche quando non potresti e si nasconde la barra superiore (con la scritta Trackr) che dovrebbe sempre rimanere fissa.

Quando apro una transazione di investimento già inserita mi apre in automatico il selettore del ticker (il menù a discesa con i ticker trovati), si dovrebbe aprire solo se clicco sul ticker.

Nella pagina investimenti se per un portafoglio il P/L è molto alto la stringa con "PL (%)" va a capo, rimane solo il simbolo € sulla riga sopra

Come segno gli investimenti nel grafico di Andamento Saldo? ha senso far vedere il grafico quando c'è una sola transazione?

Dubbio a caso: ma il saldo attuale di un conto non lo salviamo da nel db? se no, può essere utile salvarlo?

BUG: ho cliccato su ricarica (quando c'è un aggiornamento) ed è diventato tutto lo schermo nero

Warning quando switcho per cambiare pagina: [Intervention] Ignored attempt to cancel a touchmove event with cancelable=false, for example because scrolling is in progress and cannot be interrupted.


Dobbiamo riallineare tutti i testi (principalmente placeholder) per cambiare in base all'uso del formato numero (. o , come separatore)

Rimuovere "Installa App" dalle impostazioni.

Funzione di ricerca automatica degli ETF validi inseriti.

Settare risk_free_source e market_benchmark in auto per i portafogli nuovi.

[x] Rendere Profili condivisibili. ✅

Calendario si chiude quando cambio data, meglio se si riuscisse proprio a cambiare quel calendario android orribile.