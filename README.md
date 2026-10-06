# Trackr

Personal finance PWA for tracking expenses, income, transfers, and investments. Data is stored in Supabase — sign in from any device.

Part of the **Trackrs ecosystem** — shares the same Supabase database with [pfTrackr](https://github.com/Luca404/portfolio-tracker) for investment portfolio analytics, and [fitTrackr](https://github.com/Luca404/fitness-tracker) for calorie and nutrition tracking.

**Current version:** 1.0.43

## Features

- **Transactions** — expenses, income, investments (buy/sell/free quotes), transfers between accounts
- **Recurring transactions** — weekly, monthly, yearly — auto-generated with catchup on login; recurring investments require manual confirmation before execution
- **Investment orders** — linked to pfTrackr portfolios with buy/sell validation; free quote support for gifted shares (saveback, broker bonuses)
- **Multi-profile** — separate data scopes (e.g. personal / freelance), switchable from Settings
- **Shared profiles** — owner/editor/viewer roles, email invitations, accept/reject/cancel and membership management; viewer access is read-only at database level
- **Categories** — with subcategories and per-period stats
- **Accounts** — bank accounts and wallets with real-time balance calculation
- **Portfolios** — Render startup warmup, background summary/detail loading, shared cache and manual refresh; mobile overview with history, allocation and expandable positions
- **Statistics** — charts and trends with a customizable date range
- **Notification bell** — overdue recurring investment reminders with inline completion flow
- **Kakebo import** — multi-step migration wizard with atomic server-side RPC and balance diagnostics
- **Backup** — JSON v2 export of the active financial profile, all eight financial entity sets and their IDs/relationships; excludes Auth, fitness and invitations; no JSON restore UI
- **i18n** — English, Italian, Spanish
- **Installable PWA** — works as a native app on Android, iOS, and desktop

## Stack

- React 18 + TypeScript + Vite + vite-plugin-pwa (Workbox service worker) — requires Node >=22.13 (`nvm use`)
- Tailwind CSS 4 (mobile-first, dark mode)
- Supabase (PostgreSQL + Auth — email/password + RLS)
- React Router 7
- Context API — `AuthContext`, `DataContext`, `SettingsContext`
- react-i18next (EN, IT, ES)

## Getting Started

Create `.env.local`:

```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_PF_BACKEND_URL=https://portfolio-tracker-p6ha.onrender.com
```

```bash
nvm use
npm ci
npm run dev     # → http://localhost:5174
npm run build   # → dist/
npm run preview
```

### Local development with Supabase CLI

```bash
# Requires Docker
supabase start

# Inspect the shared migration ledger before any changes
supabase link --project-ref <project-id>
supabase migration list --linked
supabase db push --linked --dry-run
```

For local development, use the URL and publishable key reported by `supabase status`; check them on each installation. `.env.example` uses the local API at `http://127.0.0.1:54321`, which is separate from the hosted database. Keep `.env.local` out of Git.

Trackr and FitTrackr share the hosted database. Follow [the migration workflow](supabase/README.md) for schema updates and isolated security tests. A local database reset deletes local data; it is not an update step for an existing installation. Never reset the linked hosted database.

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
│   ├── api.ts             # Supabase CRUD and financial RPCs
│   ├── portfolioApi.ts    # Authenticated investment requests and order metadata
│   ├── portfolioData.ts   # Shared queue, summary/detail cache and invalidation
│   ├── supabase.ts        # Supabase client factory
│   ├── recurring.ts       # Shared recurring rule helpers (date math, payload builders)
│   └── sessionCache.ts    # User/profile cache keys, cleanup and stale-response guards
├── locales/               # en.json, it.json, es.json
└── types/index.ts
```

## Data model

All data is **profile-scoped**. Each user can have multiple profiles (e.g. personal / freelance) and switch between them from Settings. The active profile is stored in `localStorage['activeProfileId']`.

Key tables: `profiles`, `accounts`, `categories`, `subcategories`, `transactions`, `transfers`, `recurring_transactions`, `portfolios`, `orders`.

`profile_members` controls shared-profile access. Members can read; editors and the actual owner can write. Financial rows keep immutable identity/profile fields and validate parent references within the same profile. Invitation changes use authenticated RPCs. Supabase owns session persistence; application caches are scoped to user/profile and cleared when identity changes.

Investment transactions link to `orders` in pfTrackr via `transaction_id`. **Free quotes** (saveback, broker bonuses) create an `orders` row only — no `transactions` row, no cash debit.

Account balances are computed in `DataContext` at runtime (`initial_balance` + transactions + transfers) — not stored in the DB.

## Investment flow

1. Select the **Investment** tab → choose a portfolio
2. Fill in ticker/ISIN, quantity, price, commission, order type (buy/sell)
3. Optionally toggle **Free quote** — hides the account selector; creates only a portfolio order
4. On submit: an atomic RPC creates/updates the transaction, linked order and optional recurrence (free quotes remain orders-only); linked edits and deletions are atomic too
5. Free quotes appear in the Transactions list with a 🎁 badge and are editable/deletable

## Deployment

Deployed on **Vercel** at [trackr-dusky.vercel.app](https://trackr-dusky.vercel.app) — auto-deploys on push to `main`. Development happens on the `dev` branch. Multicurrency remains deferred and is not part of the `main` release or the shared security migrations.

Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_PF_BACKEND_URL` as environment variables in Vercel, and use Node 22 for builds. The portfolio backend is hosted on Render at `https://portfolio-tracker-p6ha.onrender.com`; `src/config.ts` provides this default for every portfolio request. A different portfolio backend requires updating the CSP `connect-src` allowlist in `vercel.json`. Update **Site URL** in Supabase Dashboard → Authentication → URL Configuration to match the production URL.

## Checks and documentation

Run `npm run lint -- --max-warnings=0`, `npm test`, `npm audit --audit-level=low` and `npm run build`. GitHub Actions runs these checks plus SQL permission/integrity/concurrency tests in isolated PostgreSQL 17, without connecting to production. See the [documentation index](docs/README.md) for the release record, known issues, backlog and shared-database workflow.
