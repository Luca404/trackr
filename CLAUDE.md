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
  category_type?: 'expense' | 'income' | 'investment' | null
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
```

## Profili multipli

Ogni account (email) può avere più profili, ciascuno con dati separati (conti, categorie, transazioni, trasferimenti, portafogli). Un profilo corrisponde a un insieme di dati indipendente (es. "Personale" vs "Freelance").

- Tabella `profiles`: `id UUID`, `user_id UUID` (FK auth.users), `name TEXT`. Il profilo principale ha `id = auth.uid()`.
- Tutte le tabelle dati (`accounts`, `categories`, `transactions`, `transfers`, `portfolios`, `recurring_transactions`) hanno `profile_id UUID` (FK → `profiles.id`, ON DELETE CASCADE)
- Il profilo attivo è in `localStorage['activeProfileId']` e in `apiService._activeProfileId`
- `apiService.setActiveProfile(id)` va chiamato prima di qualsiasi query — lo fa `DataContext.fetchAllData` all'avvio
- Tutte le query GET filtrano per `profile_id`; tutte le INSERT includono `profile_id`
- Il selettore profili è in `SettingsPage` (sezione "Profili"): switch, rinomina, aggiungi, elimina
- Il profilo principale (`id = user_id`) non è eliminabile (RLS blocca DELETE dove `id = user_id`)

## Contesti React

### DataContext (`src/contexts/DataContext.tsx`)
- Tiene in memoria accounts, categories, transactions, transfers, portfolios (cache in-memory, no localStorage)
- Si inizializza alla detection della sessione Supabase via `onAuthStateChange`
- Espone `refreshAll()`, `refreshTransactions(startDate?, endDate?)`, `refreshTransfers()`, `refreshPortfolios()`, e CRUD ottimistico per tutti i tipi
- Espone `userProfiles`, `activeProfile`, `switchProfile(profile)`, `createUserProfile(name)`, `updateUserProfile(id, name)`, `deleteUserProfile(id)`
- All'avvio carica i profili, risolve il profilo attivo da localStorage, chiama `apiService.setActiveProfile()` prima di caricare i dati
- Ricalcola `current_balance` degli account via `useEffect` ogni volta che cambiano transactions o transfers:
  - transactions: income +, expense/investment -
  - transfers: `from_account_id` -, `to_account_id` +

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
Tabelle: `profiles`, `accounts`, `categories`, `subcategories`, `transactions`, `recurring_transactions`, `transfers`, `portfolios`, `orders`
- RLS abilitato su tutte le tabelle (`user_id = auth.uid()`)
- Trigger `on_auth_user_created` crea automaticamente il profilo al signup
- `current_balance` degli account non è una colonna DB — calcolato in DataContext
- `transfers` ha colonne: `from_account_id`, `to_account_id`, `amount`, `description`, `date` — **non** usa la tabella `transactions`

## Default data
- Se `getAccounts()` ritorna vuoto → crea "Conto Corrente" e "Contanti" per l'utente
- Se `getCategories()` ritorna vuoto per un gruppo (expense/income/investment) → crea categorie predefinite
- Logica in `fetchAllData` di DataContext: chiama `apiService.createDefaultAccounts()` / `apiService.createDefaultCategories(existing)` se mancano

## Pattern UI
- **Mobile-first**: layout pensato per touch, bottoni grandi, bottom nav
- **Dark mode**: tutte le classi usano `dark:` prefix di Tailwind
- **Card**: classe utility `.card` definita in `index.css`
- **Aggiunta elementi**: no FAB — ogni lista ha una riga/tile con cerchio "+" in fondo
- **Icone categorie**: emoji, con suggerimento automatico basato su keyword italiane (vedi `CategoriesPage.tsx`)
- **Swipe navigazione**: `useSwipeNavigation` gestisce lo swipe orizzontale tra pagine. Lo swipe cambia sempre pagina (non ci sono più tab-swipe). Ai bordi (prima/ultima pagina) non mostra l'animazione di trascinamento e non naviga in quella direzione.
- **Skeleton loading**: ogni pagina ha il proprio skeleton in `SkeletonLoader.tsx` (`TransactionsSkeleton`, `AccountsSkeleton`, `CategoriesSkeleton`, `StatsSkeleton`, `DashboardSkeleton`, `PortfoliosSkeleton`). Viene mostrato dentro `<Layout>` così header e nav restano visibili durante il caricamento.
- **Refresh**: pulsante rotella in header (accanto alle impostazioni) chiama `DataContext.refreshAll()` con `animate-spin` durante il fetch.

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

- **`registerBackHandler`** (esportato da `Modal.tsx`): registra un handler back per stati interni a un form (es. `selectedCategory` in `TransactionForm`) senza usare un Modal vero. Restituisce un cleanup da passare a `useEffect`.

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
- Per `type=investment`, il TransactionForm salta la griglia categorie (auto-seleziona la prima categoria investment) e mostra un form testuale con campi ticker, quantità, prezzo/unità, commissioni → il totale viene calcolato automaticamente. I campi ticker/quantity/price vengono salvati su `transactions` oltre all'importo totale.
- Per `type=transfer`, il TransactionForm mostra un form Da→A con tastierino. Al submit chiama `apiService.createTransfer()` (tabella `transfers`) — nessuna riga viene inserita in `transactions`.
- `TransactionsPage` mostra una lista unificata: `transactions` + `transfers` merged e ordinati per data. I trasferimenti mostrano "Conto A → Conto B" come sottotitolo.
- `account_id` nelle transazioni è un `number` (ID Supabase), non una stringa
- `current_balance` degli account viene calcolato in DataContext sommando `initial_balance` + transactions + transfers — non è mai scritto in Supabase
- `updateAccount` ignora il campo `current_balance` nel payload (non è una colonna DB)
- Non c'è Redux né Zustand: tutto lo stato globale è nei Context

## Deployment
- **Hosting**: Vercel — deploy automatico ad ogni `git push main`
- **Repo**: github.com/Luca404/trackr

## Problemi noti
- **Sessione zombie dopo cancellazione utente dal DB**: se un utente viene cancellato direttamente da Supabase (auth.users + profiles), l'app può non fare logout automatico perché il JWT locale è ancora valido e `supabase.auth.getUser()` può restituire ancora l'utente dalla cache. Non è un problema reale in produzione (gli utenti non vengono cancellati direttamente dal DB). Workaround: fare logout manuale dall'app, o cancellare i dati del browser.
- **Barra autofill Chrome Android**: quando si apre la tastiera su un input, Chrome mostra una barra nera con icone password/carta/indirizzo. Non è risolvibile via HTML/CSS — è UI nativa del browser (`KeyboardAccessoryView`). Chrome ignora intenzionalmente `autoComplete="off"` per questa funzione. Soluzione solo lato utente: disabilitare autofill nelle impostazioni Chrome.

## TODO funzionalità
- [ ] **Eliminazione categoria con transazioni associate**: ora eliminare una categoria lascia le transazioni con `category` = nome stringa orfano. Possibili approcci: (a) bloccare l'eliminazione se ci sono transazioni associate mostrando il conteggio; (b) chiedere all'utente a quale categoria spostare le transazioni prima di eliminare; (c) assegnare automaticamente le transazioni a una categoria "Senza categoria". Stessa problematica per le sottocategorie. Da implementare in `confirmDeleteCategory` / `confirmDeleteSubcategory` in `CategoriesPage.tsx`.
- [ ] **Logo app**: rifinire il logo (icon-512.png, icon-192.png) e aggiornare icon.svg coerentemente — logo attuale provvisorio generato con AI
