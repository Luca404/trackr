# Trackr PWA — CLAUDE.md

Personal finance PWA. React 18 + TypeScript + Vite + Supabase (direct, no own backend). Part of the Trackr ecosystem — see root `CLAUDE.md` and `../docs/supabase-schema.md`.

## Stack

React 18 TS, Vite + vite-plugin-pwa, Tailwind CSS (mobile-first, dark mode), Supabase (`@supabase/supabase-js`), React Router, react-i18next. Requires Node 20+.

## Commands

```bash
npm run dev       # → http://localhost:5174
npm run build     # requires Node 20+
npm run preview
npm run lint
```

## Env vars (`.env.local`)

```env
VITE_SUPABASE_URL=https://...
VITE_SUPABASE_ANON_KEY=...       # anon/publishable key
VITE_PF_BACKEND_URL=https://...  # portfolio-tracker backend on Render
```

## Architecture

```
Component / Page
  → apiService (src/services/api.ts)      ← direct Supabase calls
    → supabase (src/services/supabase.ts) ← Supabase PostgreSQL + Auth
  → portfolio-tracker backend (Railway)   ← portfolio data only (PortfoliosPage, TransactionForm, KakeboImport)
```

- **Online-first**: DataContext loads all data from Supabase at startup, keeps in-memory React state. No IndexedDB/localStorage cache for data.
- **No Redux/Zustand**: all global state in React Contexts (AuthContext, DataContext, SettingsContext).
- **`current_balance`** on accounts is NOT a DB column — DataContext calculates it from `initial_balance` + transactions + transfers on every update.
- **Optimistic writes**: pages call `apiService.create/update/delete*()` then update DataContext optimistically.

## Profile system

- `get_my_profiles()` RPC is the **single entrypoint at startup** — repairs missing membership, creates profile if absent.
- `profile_members` is the **source of truth for permissions** (owner/editor/viewer). All RLS uses `is_profile_member()`.
- Active profile stored in `localStorage['activeProfileId']` and `apiService._activeProfileId`. Call `apiService.setActiveProfile(id)` before any query — `DataContext.fetchAllData` does this automatically.
- Main profile (`id = user_id`) is not deletable.
- **TODO**: update `on_auth_user_created` Supabase trigger to also insert into `profile_members` — currently `get_my_profiles()` repairs this on every startup.
- On profile switch: remove `pf_summaries_cache` from localStorage to force portfolio reload.

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

CLI project at root `../supabase/`. Run all `supabase` CLI commands from `Python/`. Migrations: `../supabase/migrations/`. Schemas: `../supabase/schemas/`.
