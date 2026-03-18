# Trackr PWA

A personal finance tracker that runs entirely in the browser. All data is stored locally via IndexedDB — no server required.

## Features

- **Transactions**: expenses, income, investments, and transfers between accounts
- **Categories**: with subcategories and per-period statistics
- **Accounts**: bank accounts and wallets with automatic balance calculation
- **Portfolio**: investment tracking
- **Statistics**: charts and trends with a customizable date range
- **Backup / Restore**: export and import all data as JSON
- **Installable PWA**: works as a native app on Android, iOS, and desktop
- **Offline-first**: always works, even without an internet connection

## Stack

- React 18 + TypeScript
- Vite + Vite PWA Plugin (service worker, manifest)
- Tailwind CSS
- IndexedDB (via [db.ts](src/services/db.ts))
- React Router 6

## Getting Started

```bash
npm install
npm run dev       # Dev server at http://localhost:5174
npm run build     # Production build → dist/
npm run preview   # Preview the build
```

## Project Structure

```
src/
├── components/
│   ├── common/          # Modal, FAB, LoadingSpinner, ConfirmDialog, ...
│   ├── layout/          # Main layout with navigation
│   └── transactions/    # TransactionForm
├── contexts/
│   ├── AuthContext.tsx  # Local authentication
│   └── DataContext.tsx  # Data state (transactions, categories, accounts, portfolios)
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
│   ├── db.ts            # IndexedDB wrapper (generic CRUD)
│   ├── localStorage.ts  # Service layer: data logic + local auth
│   └── api.ts           # Unified access point (re-exports localStorage service)
├── types/
│   └── index.ts
├── App.tsx
└── main.tsx
```

## Local Data

The IndexedDB database (`trackr-db`) contains the following stores:

| Store | Contents |
|---|---|
| `users` | Local user |
| `transactions` | Transactions |
| `categories` | Categories |
| `subcategories` | Subcategories |
| `accounts` | Financial accounts |
| `portfolios` | Investment portfolios |

### Backup format (JSON)

```json
{
  "version": 1,
  "exportDate": "2026-...",
  "userId": "local-user",
  "data": {
    "transactions": [...],
    "categories": [...],
    "accounts": [...],
    "portfolios": [...]
  }
}
```

Backup can be downloaded from **Settings → Export Backup**.

## Installing as an App

**Android** — Chrome: menu → "Add to Home screen"

**iOS** — Safari: Share → "Add to Home Screen"

**Desktop** — Chrome/Edge: install icon in the address bar

## Deployment

The app is a static site and can be deployed anywhere (Vercel, Netlify, GitHub Pages, etc.).

```bash
npm run build
# deploy the dist/ folder
```

The [vercel.json](vercel.json) file is already configured with the SPA routing rules needed for Vercel.

## Notes

- Data lives in the browser: clearing browser data means losing everything — make regular backups
- ~50–100 MB of storage available (depends on the browser)
- Data does not sync across different devices
