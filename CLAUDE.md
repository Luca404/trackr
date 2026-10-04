# Trackr PWA — CLAUDE.md

Personal finance PWA. React 18 + TypeScript + Vite + Supabase (direct, no own backend). Shares the hosted Supabase database with `../fitness-tracker/`. The migration workflow is documented in `supabase/README.md`.

## Stack

React 18 TS, Vite + vite-plugin-pwa, Tailwind CSS (mobile-first, dark mode), Supabase (`@supabase/supabase-js`), React Router, react-i18next. Requires Node >=22.13. Use `nvm use` before installing/testing.

## Commands

```bash
npm run dev       # → http://localhost:5174
npm run build     # requires Node >=22.13
npm run preview
npm run lint
npm test
```

## Env vars (`.env.local`)

```env
VITE_SUPABASE_URL=https://...
VITE_SUPABASE_PUBLISHABLE_KEY=...       # anon/publishable key
VITE_PF_BACKEND_URL=https://...  # portfolio-tracker backend on Render
```

## Architecture

```
Component / Page
  → apiService (src/services/api.ts)      ← direct Supabase calls
    → supabase (src/services/supabase.ts) ← Supabase PostgreSQL + Auth
  → portfolio-tracker backend (Railway)   ← portfolio data only (PortfoliosPage, TransactionForm, KakeboImport)
```

- **Online-first**: DataContext loads all data from Supabase at startup, keeps in-memory React state. Financial lists stay in React state; portfolio summaries use a cache scoped to user/profile.
- **No Redux/Zustand**: all global state in React Contexts (AuthContext, DataContext, SettingsContext).
- **`current_balance`** on accounts is NOT a DB column — DataContext calculates it from `initial_balance` + transactions + transfers on every update.
- **Writes**: transaction/order/recurrence changes use atomic PostgreSQL RPCs.
- **Optimistic UI**: pages call `apiService.create/update/delete*()` then update DataContext optimistically.

## Profile system

- `get_my_profiles()` RPC is the **single entrypoint at startup** — repairs missing membership, creates profile if absent.
- `profile_members` is the **source of truth for permissions** (owner/editor/viewer). All RLS uses `is_profile_member()`.
- Active profile stored in `localStorage['activeProfileId']` and `apiService._activeProfileId`. Call `apiService.setActiveProfile(id)` before any query — `DataContext.fetchAllData` does this automatically.
- Main profile (`id = user_id`) is not deletable.
- Profile INSERT creates owner membership through `trackr_private.create_owner_membership`; `get_my_profiles()` remains a repair safety net.
- Portfolio summary keys include user ID and profile ID. Use `clearPortfolioCache()` for invalidation, and `clearSessionData()` on logout.

## UI conventions

- **Inputs**: always use `.input-field` utility class (defined in `index.css`). Never use bare `input`. For inline flex inputs: same Tailwind classes with `flex-1` instead of `w-full`.
- **Dark mode**: all classes use `dark:` Tailwind prefix.
- **No FAB**: each list ends with a `+` circle tile row — no floating action button.
- **Mobile-first**: large touch targets, bottom nav, `height: 100dvh` layout shell.
- **Skeleton loading**: each page has its own skeleton variant in `SkeletonLoader.tsx`. Always rendered inside `<Layout>` so nav stays visible.
- **Currency formatting**: always use `SettingsContext.formatCurrency()` — never `toLocaleString()` hardcoded.

## i18n

`react-i18next`, default lang `en`, saved in `localStorage['lang']`. All components use `useTranslation()` → `t('key')`.
**Do not name a local variable `t`** in any component that imports `useTranslation` — it shadows the translation function.

## Version bump

`APP_MAJOR`, `APP_MINOR`, `APP_PATCH` are hardcoded constants in `vite.config.ts`. **Increment `APP_PATCH` before every push to main.** Version shown in header. `version.json` generated at build time by a Vite plugin (not tracked in `public/`).

## Default data

On first login (empty accounts or categories):
- Creates "Conto Corrente" + "Contanti" accounts.
- Creates default expense + income categories (NOT investment).
- Logic in `DataContext.fetchAllData` → `apiService.createDefaultAccounts()` / `createDefaultCategories(existing)`.

## Investment transactions

- Delete order **before** linked transaction (`deleteOrderByTransactionId` then `deleteTransaction`). FK `orders.transaction_id → transactions.id` is `ON DELETE SET NULL` — deleting transaction first makes order unfindable.
- `category_type = 'investment'` does not exist. Investment transactions use a portfolio name as `category`.
- Portfolio summaries cached in `localStorage['pf_summaries_cache']` with 24h TTL (5 min if all values = 0).

## Deployment

Vercel, auto-deploy on `git push main`. Repo: `github.com/Luca404/trackr`.

## Known issues

See `docs/known-issues.md`. Change log: `docs/code-changes.md`. Improvements backlog: `docs/future-improvements.md`.

## Supabase

The CLI project is `supabase/` in this checkout. The hosted project and migration history are shared with fitTrackr; synchronize the applied history before a push and inspect `supabase db push --dry-run`. Never run `supabase db reset --linked`. Security tests use a separate local database, not the application database.
