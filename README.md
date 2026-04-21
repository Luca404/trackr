# Trackr

Personal finance PWA for tracking expenses, income, transfers, and investments. Data is stored in Supabase — sign in from any device.

Part of the **Trackrs ecosystem** — shares the same Supabase database with [pfTrackr](../portfolio-tracker) for investment portfolio analytics, and [fitTrackr](../fitness-tracker) for calorie and nutrition tracking.

**Current version:** 1.0.32

## Features

- **Transactions** — expenses, income, investments (buy/sell/free quotes), transfers between accounts
- **Recurring transactions** — weekly, monthly, yearly — auto-generated with catchup on login; recurring investments require manual confirmation before execution
- **Investment orders** — linked to pfTrackr portfolios with buy/sell validation; free quote support for gifted shares (saveback, broker bonuses)
- **Multi-profile** — separate data scopes (e.g. personal / freelance), switchable from Settings
- **Categories** — with subcategories and per-period stats
- **Accounts** — bank accounts and wallets with real-time balance calculation
- **Portfolios** — live summaries fetched from the pfTrackr backend (Render)
- **Statistics** — charts and trends with a customizable date range
- **Notification bell** — overdue recurring investment reminders with inline completion flow
- **Kakebo import** — multi-step migration wizard with atomic server-side RPC and balance diagnostics
- **Backup** — export all data as JSON
- **i18n** — English, Italian, Spanish
- **Installable PWA** — works as a native app on Android, iOS, and desktop

## Stack

- React 18 + TypeScript + Vite + vite-plugin-pwa (Workbox service worker) — requires Node 20+
- Tailwind CSS (mobile-first, dark mode)
- Supabase (PostgreSQL + Auth — email/password + RLS)
- React Router 6
- Context API — `AuthContext`, `DataContext`, `SettingsContext`
- react-i18next (EN, IT, ES)

## Getting Started

Create `.env.local`:

```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_PF_BACKEND_URL=https://portfolio-tracker-p6ha.onrender.com
```

```bash
npm install
npm run dev     # → http://localhost:5174
npm run build   # → dist/
npm run preview
```

### Local development with Supabase CLI

```bash
# Requires Docker
supabase start

# Pull latest schema from remote
supabase link --project-ref <project-id>
supabase db pull --schema public

# Apply to local DB
supabase db reset
```

Local Supabase credentials are deterministic — reuse them in `.env.local` across machines.

## Project Structure

```
src/
├── components/
│   ├── common/            # Modal, ConfirmDialog, SkeletonLoader, PeriodSelector, TransactionDateModal, ...
│   ├── investments/       # InvestmentOrderForm — shared buy/sell/free-quote form
│   ├── layout/            # Layout shell with sticky header, bottom nav, notification bell
│   └── transactions/      # TransactionForm — expense / income / investment / transfer
├── contexts/
│   ├── AuthContext.tsx    # Supabase Auth, session management
│   ├── DataContext.tsx    # In-memory cache: accounts, categories, transactions, transfers, freeOrders, portfolios
│   └── SettingsContext.tsx # Currency format (dot/comma), locale
├── hooks/
│   ├── usePeriod.ts
│   ├── useSwipeNavigation.ts
│   └── useSkeletonCount.ts
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   ├── TransactionsPage.tsx
│   ├── AccountsPage.tsx
│   ├── CategoriesPage.tsx
│   ├── StatsPage.tsx
│   ├── PortfoliosPage.tsx
│   └── SettingsPage.tsx
├── services/
│   ├── api.ts             # All Supabase CRUD + portfolio summary cache
│   ├── supabase.ts        # Supabase client factory
│   └── recurring.ts       # Shared recurring rule helpers (date math, payload builders)
├── locales/               # en.json, it.json, es.json
└── types/index.ts
```

## Data model

All data is **profile-scoped**. Each user can have multiple profiles (e.g. personal / freelance) and switch between them from Settings. The active profile is stored in `localStorage['activeProfileId']`.

Key tables: `profiles`, `accounts`, `categories`, `subcategories`, `transactions`, `transfers`, `recurring_transactions`, `portfolios`, `orders`.

Investment transactions link to `orders` in pfTrackr via `transaction_id`. **Free quotes** (saveback, broker bonuses) create an `orders` row only — no `transactions` row, no cash debit.

Account balances are computed in `DataContext` at runtime (`initial_balance` + transactions + transfers) — not stored in the DB.

## Investment flow

1. Select the **Investment** tab → choose a portfolio
2. Fill in ticker/ISIN, quantity, price, commission, order type (buy/sell)
3. Optionally toggle **Free quote** — hides the account selector; creates only a portfolio order
4. On submit: creates a `transactions` row + a linked `orders` row (or orders-only for free quotes)
5. Free quotes appear in the Transactions list with a 🎁 badge and are editable/deletable

## Deployment

Deployed on **Vercel** — auto-deploys on push to `main`. Development happens on the `dev` branch.

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PF_BACKEND_URL` as environment variables in Vercel. Update **Site URL** in Supabase Dashboard → Authentication → URL Configuration to match the production URL.
