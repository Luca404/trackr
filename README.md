# Trackr PWA

A personal finance tracker built as a PWA. Data is synced to the cloud via Supabase — sign in from any device.

## Features

- **Transactions**: expenses, income, investments, and transfers between accounts
- **Categories**: with subcategories and per-period statistics
- **Accounts**: bank accounts and wallets with automatic balance calculation
- **Portfolio**: investment tracking
- **Statistics**: charts and trends with a customizable date range
- **Backup**: export all data as JSON
- **Installable PWA**: works as a native app on Android, iOS, and desktop

## Stack

- React 18 + TypeScript
- Vite + Vite PWA Plugin (service worker, manifest)
- Tailwind CSS
- Supabase (PostgreSQL + Auth)
- React Router 6

## Getting Started

```bash
npm install
npm run dev       # Dev server at http://localhost:5174
npm run build     # Production build → dist/
npm run preview   # Preview the build
```

### Environment variables

Create a `.env.local` file:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Project Structure

```
src/
├── components/
│   ├── common/          # Modal, FAB, LoadingSpinner, ConfirmDialog, ...
│   ├── layout/          # Main layout with navigation
│   └── transactions/    # TransactionForm
├── contexts/
│   ├── AuthContext.tsx  # Supabase Auth (email + password)
│   └── DataContext.tsx  # In-memory cache: transactions, categories, accounts
├── hooks/
│   ├── usePeriod.ts
│   └── useSwipeNavigation.ts
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
│   ├── api.ts           # CRUD via Supabase
│   └── supabase.ts      # Supabase client
├── types/
│   └── index.ts
├── App.tsx
└── main.tsx
```

## Installing as an App

**Android** — Chrome: menu → "Add to Home screen"

**iOS** — Safari: Share → "Add to Home Screen"

**Desktop** — Chrome/Edge: install icon in the address bar

## Deployment

Static site, deployable anywhere (Vercel, Netlify, GitHub Pages, etc.).

```bash
npm run build
# deploy the dist/ folder
```

Before deploying, update the **Site URL** in Supabase Dashboard → Authentication → URL Configuration to match the production URL (needed for email confirmation links).
