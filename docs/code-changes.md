Implemented code changes
========================

2026-10-06 — Documentation and next roadmap task

- Prioritized Render keepalive as the next task: a lightweight `/health` endpoint and an independent cron every 10 minutes, preferably Supabase Cron with `pg_net`. This entry records planned work; no cron job or backend change was enabled.
- Updated the published 1.0.43 release status, recap-before-detail loading order, cache/refresh semantics, user-reported latency and remaining backend performance work. The frontend version stays 1.0.43.

2026-10-06 — Shared migration ledger synchronization

- Added Trackr's mirrored `20261006120000_correct_prepared_batch_weight` migration, identical to FitTrackr's committed source. It was already recorded in the shared hosted ledger.
- Verified the remote RPC body, SECURITY INVOKER settings and authenticated-only execution grants in a read-only transaction. Linked dry-run and push report up to date; no application records were modified. Frontend version remains 1.0.43.

2026-10-06 — v1.0.43 (published to main)

- Wake Render at authenticated startup and prefetch active-profile investment summaries and portfolio details through a single queue. Prioritize the open portfolio and reuse in-flight requests.
- Share validated summary/detail/history caches across pages and sessions, retain expired data during refresh, and cancel stale requests on invalidation/profile changes. Manual refresh reloads Supabase and visible investment data without waiting for every background detail.
- Replace the portfolio detail with a mobile overview: value/gain hero, net capital, position count, XIRR, value/performance history, allocation by market value/type and expandable named positions. Desktop retains a table.
- Normalize backend `portfolio_xirr` and day-month-year history dates; respect `positions_only`, price failures and currency boundaries. Invalidate after successful financial writes, including transaction deletion and portfolio edits.
- Published in [commit cc4abc0](https://github.com/Luca404/trackr/commit/cc4abc04629e1c37173055b0da0fa9c246657806), triggering the configured Vercel deployment; the user confirmed the new view works. The 30 tests, lint, audit and build passed locally. Remaining backend limits and verification boundaries are documented in [the investment release notes](investments-1.0.43.md); no investment database/backend changes were made.

2026-10-06 — CI security follow-up

- Updated only the transitive `source-map-js` lockfile entry from 1.2.1 to 1.2.2 to address GHSA-68fv-2mgg-jv7q and restore the CI audit check.
- `npm audit --audit-level=low` reports zero vulnerabilities; all eight frontend tests, lint without warnings and the production build pass. The application version remains 1.0.42 because this change affects development/build tooling only.

2026-10-06 — v1.0.42

- Corrected the Vercel CSP to authorize the active Render portfolio backend (`https://portfolio-tracker-p6ha.onrender.com`) instead of the retired Railway service.
- Centralized the backend URL in `src/config.ts` for portfolio summaries, details, instrument lookup and Kakebo import, preserving `VITE_PF_BACKEND_URL` overrides for local development.
- Updated the environment example and current setup documentation to Render.
- Verified all eight frontend tests, lint without warnings, the production build and alignment between the default Render origin and CSP. Deployment is not included in these local checks.

2026-10-04 — v1.0.41

- Aligned the local checkout with main; left development/multicurrency separate.
- Applied seven versioned migrations to local Trackr and the shared hosted Supabase; synchronized the FitTrackr migration ledger.
- Enforced owner/editor/viewer boundaries, immutable financial identity/scope, consistent parent references, protected main profiles and authenticated invitation RPCs with rate limits.
- Corrected FitTrackr meal-item RLS and added the entry/meal composite foreign key without deleting historical data.
- Moved linked money/order/recurrence writes and deletions into atomic RPCs; added idempotent recurring occurrences and month-end date handling.
- Removed redundant token storage, scoped portfolio caches to user/profile, discarded stale responses and prevented viewer initialization writes.
- Added active-profile JSON export v2, SQLite/import limits, malformed/empty import rejection and finite financial-value checks.
- Updated dependencies and Tailwind 4, required Node >=22.13, added Vercel security headers and external theme startup.
- Added frontend, SQL and concurrency coverage plus CI; changed the CI database image to official PostgreSQL 17 after an ECR rate limit.
- Published [Trackr 1.0.41](https://trackr-dusky.vercel.app); both CI jobs and production login/theme/header checks passed. See [the complete verification record](security-fixes-2026-10-04.md).

Earlier entries below describe changes at their original dates, including pfTrackr work; they are not current backend audit results.

2026-09-15

1. Removed known frontend dependency vulnerabilities
- Updated dependencies within their existing compatible ranges
- Upgraded `react-router-dom` from 6.x to 7.18.3 to close the final runtime advisories
- Updated the production lockfile and bumped the application version to 1.0.40
- Verified the dependency tree with `npm audit` and a production build

Reason
- The deployed dependency tree contained known advisories, including runtime dependencies
- React Router required a targeted major upgrade after compatible updates removed the remaining tooling advisories

2026-03-30

1. Removed `description` from pfTrackr portfolio flow
- Removed `description` from the backend portfolio schema
- Removed backend reads/writes of `description` in the portfolio router
- Removed create/edit UI fields for portfolio descriptions in pfTrackr frontend
- Removed frontend assumptions that a portfolio always exposes `description`

Reason
- The current schema in use no longer includes a `description` column on `portfolios`
- Leaving the field in pfTrackr caused runtime errors during local portfolio creation

2. Default pfTrackr-created portfolios to the main profile
- Added `profile_id = user_id` when creating portfolios from pfTrackr backend

Reason
- pfTrackr does not yet implement full multi-profile support
- Without `profile_id`, portfolios created from pfTrackr were invisible in Trackr, which filters portfolios by active profile

3. Added an initial backend test and sanity-check base for pfTrackr
- Added `pytest` to backend requirements
- Added tests for portfolio aggregation, XIRR, and stock split adjustment
- Added sanity checks for invalid split ratios and invalid adjusted split results

Reason
- Portfolio math and split handling are fragile logic paths
- The project previously had no automated protection on these calculations

4. Added summary-level sanity warnings for suspicious portfolio states
- Warn when a computed position has non-positive quantity during portfolio aggregation
- Warn when a portfolio has positive cost basis but zero total value

Reason
- These states can indicate broken pricing, invalid portfolio math, or stale/incomplete market data
- They are easy to miss because the UI can still render apparently valid output

5. Added tests for backend order input validation
- Added coverage for valid orders
- Added coverage for invalid quantity, price, commission, order type, and instrument type

Reason
- Order validation is a first-line safety barrier before portfolio math is affected
- These checks are easy to regress silently during future backend changes

6. Tightened frontend validation for investment symbol and commission inputs in Trackr
- Prevented ticker search dropdowns from auto-opening when an existing investment is loaded in edit mode
- Required users to confirm the symbol from the dropdown before submitting an investment transaction
- Added the same confirmed-symbol and non-negative commission rules to the "New Position" form
- Disabled submit buttons when quantity, price, or commission inputs are invalid

Reason
- Trackr was still letting invalid or manually typed symbols reach awkward backend error paths
- Edit mode was opening the symbol picker automatically just because a prefilled ticker existed

7. Extracted a reusable investment order form and enabled editing portfolio orders
- Replaced the ad-hoc portfolio "New Position" modal with a reusable `InvestmentOrderForm`
- Added local order editing from the portfolio detail modal under the Orders section
- Added direct Supabase update support for standalone orders in the Trackr API service
- Removed the temporary inline validation warnings and kept disabled submit-only UX
- Synced linked investment transactions when editing an order that has `transaction_id`

Reason
- The portfolio order UI was duplicated and drifting away from the investment transaction UX
- Portfolio orders were view-only even though they are part of the active position state

8. Added sell-side holdings validation to the shared investment order form
- Reused the same sell guard in investment transactions, new portfolio positions, and order edits
- Disabled submit when a sell ticker is not already present in the selected portfolio context
- Disabled submit when sell quantity exceeds the currently available holdings for that ticker
- Ignored the order currently being edited so sell validation works correctly during updates

Reason
- Trackr writes orders directly to Supabase, so frontend validation is the main protection path there
- The shared order component is now the right place to enforce consistent buy/sell behavior across the app

9. Added end-to-end buy/sell support and fixed shared-form markup issues in Trackr
- Added `buy/sell` support to the shared investment order component and reused it in transaction creation, new portfolio positions, and order edits
- Made investment transaction cash flow consistent with order type so sells increase the selected account instead of decreasing it
- Prevented invalid nested markup by avoiding `<form>` nesting when the shared investment component is embedded inside the transaction modal
- Fixed `PeriodSelector` markup so navigation buttons are no longer nested inside another button
- Fixed the transaction-modal render loop caused by the shared form emitting `onChange` through an unstable callback reference

Reason
- Buy/sell needed to work consistently across order creation, editing, and linked cash-account updates
- The shared investment form is now the single UX and validation surface for financial orders, so markup and render stability issues had to be corrected there

10. Unified date-selection UX and added recurring investment support in transaction flows
- Extracted a reusable `TransactionDateModal` shared by normal transactions and investment transactions
- Added recurring-rule create/update/delete handling during transaction edits
- Extended recurring investment rules with order metadata so due recurrences can generate both the transaction and its linked portfolio order
- Removed `ter` from the recurring-rule model because it is ETF-only metadata and not required for recurring execution
- Kept portfolio-only order modals non-recurring because they still lack the cash-account context needed for a valid recurring transaction

Reason
- Date and recurrence behavior had drifted between normal and investment transaction flows
- Recurring investments needed a real end-to-end path instead of only a UI toggle

11. Polished modal actions, delete confirmations, and duplicate-name protections in Trackr
- Unified confirmation modal button sizing so `Cancel` and `Delete` use the same height and radius
- Switched the main old modal flows to disabled-submit validation instead of browser-native required-field popups
- Kept account keypad confirmation as a full-height `✓` button while moving destructive delete actions below the keypad
- Added pre-checks that block deleting accounts, categories, and subcategories when linked transactions already exist
- Added frontend and service-level duplicate-name guards for portfolios, accounts, categories, and subcategories
- Added explicit portfolio-delete messaging that warns users linked orders and transactions will also be removed
- Fixed portfolio deletion so Trackr now actually deletes linked recurring rules, orders, and investment transactions before removing the portfolio

Reason
- Modal actions had drifted in style and behavior between the older CRUD pages and the newer investment flows
- Account/category deletion needed the same safety model already used conceptually for other core bookkeeping entities
- Duplicate names were causing ambiguous objects and breaking the assumption that a visible label identifies a single account/category/portfolio
- Portfolio deletion messaging previously promised cascade behavior that the implementation did not fully perform

12. Moved version metadata generation out of `public/` and into the build pipeline
- Bumped the app version to `1.0.28`
- Added explicit English release notes for the in-app update banner instead of exposing raw technical commit titles to end users
- Stopped rewriting `public/version.json` during build/dev startup
- Added a Vite plugin that serves `/version.json` in dev and emits `dist/version.json` during production builds
- Updated the layout update banner to prefer `releaseNotes` over `commitMsg`
- Added TypeScript declarations for the new release-notes build constant

Reason
- The old approach kept dirtying the working tree because `public/version.json` was rewritten on every build
- The user-facing update banner should show concise release information, not internal commit messages
- Version metadata still needs to be available at runtime, but it should be generated as build output rather than tracked mutable source

13. Reworked the Kakebo import flow into a clearer multi-step migration wizard
- Added a dedicated wizard flow in `KakeboImport.tsx` with separate steps for:
  - detected accounts and portfolios
  - detected categories
  - detected recurring transactions
  - investment import details
- Removed the old manual investment-account override flow and defaulted to automatic portfolio detection from Kakebo investment accounts
- Improved the visual structure of the Kakebo modal with:
  - a centered period summary
  - compact detected account/portfolio chips
  - category cards split by expense/income
  - expandable subcategory lists
  - sticky bottom navigation between wizard steps
- Added a dedicated review screen for recurring transactions before the investment step

Reason
- The original Kakebo import UI had become too linear and opaque for a destructive migration flow
- Users needed a chance to inspect structure, categories, recurring rules, and investment details separately before import

14. Aligned Kakebo import semantics with the current Trackr data model
- Stopped relying on old “investment categories” and instead mapped Kakebo investment accounts directly to portfolios
- Added `history_mode` support on imported portfolios so Trackr can distinguish:
  - `full_orders`
  - `positions_only`
- Added local SQL support for the `portfolios.history_mode` column and ensured the Kakebo importer writes it correctly based on the chosen investment import mode
- Improved `Posizioni correnti` UX so users can build portfolio end states inside each portfolio card without closing the input form after each insertion
- Added support for saveback/bonus investment movements as optional portfolio orders without affecting account balances

Reason
- The app no longer models investments through dedicated categories
- Imported portfolios need to remember whether they come from full order history or from end-state positions only

15. Improved Kakebo import safety, diagnostics, and recovery support
- Added a destructive confirmation dialog before import showing how many records will be deleted from the active profile:
  - accounts
  - categories
  - portfolios
  - transactions
  - transfers
  - recurring rules
  - orders
- Added detailed skipped-record diagnostics in the importer so ignored Kakebo movements can be inspected with IDs, amounts, accounts, and reasons
- Added end-of-import balance checks that compare reconstructed account results from imported data against the source Kakebo ledger
- Generated a local recovery script `database/restore_main_profile_from_local.sql` to restore one profile from the local SQL dump
- Fixed that restore script so it resets sequences to the global max ID of each table instead of the max ID of only the restored profile subset

Reason
- The Kakebo flow is destructive and had already caused real user-facing recovery needs
- Import problems need to be diagnosable without guesswork
- Manual profile restore must not break future inserts by leaving sequences behind global table state

16. Added recurring-transaction import support to Kakebo import
- Detected recurring Kakebo movements through `Movimento.numeroRipetizioni` and `calendarField`
- Added a dedicated recurring-review step that lets users:
  - enable/disable each recurring rule
  - adjust amount
  - adjust frequency
  - adjust start date
  - adjust description
- Imported normal recurring expense/income rules into `recurring_transactions`
- Imported recurring investment cash rules and, when available from the order-detail step, also attached investment metadata needed by Trackr recurring investments
- Improved the recurring-review frequency control from a plain `<select>` to a segmented toggle

Reason
- Kakebo recurring rules were previously deleted during import and never recreated in Trackr
- Recurring investments and salary-like repeating entries are important enough that users need to verify them before final import

17. Fixed recurring-date handling and tightened recurring processing behavior
- Fixed `next_due_date` calculations in both `api.ts` and `KakeboImport.tsx` to use UTC-safe date math instead of local-date parsing followed by `toISOString()`
- This prevents off-by-one-day or wrong-month drift such as monthly rules landing on the previous day in some timezone combinations
- Updated `processRecurringTransactions()` so it now throws if:
  - the recurring transaction insert fails
  - the recurring investment order insert fails
- Prevented silent advancement of `next_due_date` when creation of the actual due record did not succeed

Reason
- Recurring rules were showing confusing next due dates and could advance even when no transaction had actually been created
- Silent failure in recurring processing makes financial automation untrustworthy

18. Started moving Kakebo import to an atomic server-side RPC
- Added `supabase/kakebo_import_atomic.sql` with a first `import_kakebo_profile_atomic(profile_id, payload)` function
- The function:
  - validates the authenticated user against the target profile
  - deletes the existing profile-scoped data
  - recreates portfolios, accounts, categories, subcategories, transactions, transfers, orders, and recurring transactions from one JSON payload
  - returns inserted record counts
- Updated `KakeboImport.tsx` so the frontend now:
  - keeps parsing, review, validation, balance checks, and skipped-record logic locally
  - builds a final JSON payload
  - calls the RPC instead of doing the destructive write flow directly from the browser

Reason
- The previous Kakebo import flow still executed the critical reset/rebuild path client-side across many separate Supabase calls
- The atomic RPC is the right direction to make the destructive import all-or-nothing at the database level

19. Linked imported recurring rules back to imported historical transactions
- Added a stable `recurring_key` based on the Kakebo `movimentoId` to the Kakebo import payload
- Updated the atomic RPC so it creates recurring rules before transactions, stores a temporary `recurring_key -> recurring_id` map, and writes `transactions.recurring_id` during import
- Ensured recurring investment cash movements and recurring normal transactions can both be linked back to their imported recurring rule

Reason
- Without `transactions.recurring_id`, imported historical rows existed in the database but did not appear as recurring in the Transactions page
- The missing link was independent of `start_date`; the real issue was the lack of a stable mapping between imported Kakebo recurring movements and Trackr recurring rules

20. Centralized recurring-rule date and payload logic
- Added a dedicated `src/services/recurring.ts` helper module for recurring utilities
- Moved shared logic there for:
  - `getNextDueDate(...)`
  - deriving all due dates up to today
  - building a recurring rule draft from a transaction form
  - building insert/update payloads for recurring rules
- Updated `api.ts`, `TransactionsPage.tsx`, and `KakeboImport.tsx` to use the same recurring helpers instead of duplicating date and payload logic

Reason
- Recurring behavior had started to drift across the app because the same logic existed in several places
- Centralizing the recurring helpers reduces future bugs and makes the next server-side refactor much safer

21. Completed the Kakebo import hardening path with atomic import and recurring linkage
- Finished the move of Kakebo destructive writes to the `import_kakebo_profile_atomic(...)` Supabase RPC
- Kept parsing, review, validation, and balance diagnostics in the frontend while moving the reset/rebuild path into one DB-side function
- Ensured imported recurring rules are created before imported transactions and linked back through a stable `recurring_key`
- Improved user-facing import errors so common auth/profile/mapping failures render as readable frontend messages

Reason
- The first RPC step was only the start; the flow needed to be completed and made understandable enough to trust in production
- Imported recurring transactions had to preserve their relationship to the recurring rule, otherwise the UI still looked broken after import

22. Added recurring investment notifications and runtime confirmation flow
- Stopped auto-processing due recurring investments inside `processRecurringTransactions()` while keeping automatic creation for normal recurring expense/income rules
- Added a notification bell in the shared layout with:
  - unread count
  - full-width dropdown panel
  - per-rule overdue count badge for missed recurring investment occurrences
- Reused the transaction modal as a completion flow for recurring investments, prefilled with:
  - account
  - portfolio
  - ticker/instrument metadata
  - due date
  - quantity when available
- Made notification-triggered investment completion work correctly across page changes instead of only on the Transactions page
- Added immediate UI refresh after confirm/delete so:
  - completed reminders disappear right away
  - deleted recurring transactions restore the due notification by rewinding `next_due_date`
  - deleting an entire recurring rule removes the recurring marker and related notification without manual page refresh
- Added a `disableHistoryIntercept` mode to the shared `Modal` component for flows that should not manipulate browser back-stack state

Reason
- Recurring investments cannot be auto-executed safely with stale price/quantity assumptions
- The app needed a concrete review-before-execution path instead of silently writing incorrect portfolio orders
- The notification and delete flows had to be made consistent immediately in UI, otherwise the feature felt unreliable even when DB state was correct

2026-05-08 — v1.0.36

23. Portfolio investments page UI enhancements
- Clicking a portfolio card now opens a detail modal showing all holdings with per-position market value, absolute P/L, and P/L %
- Each portfolio card now has a "Modifica" button (top-right, stopPropagation) that opens the existing edit modal — card click and edit are now separate interactions
- Added P/L % display below the P/L value on each portfolio card
- Added P/L % to the total investments banner (e.g. +€1,234 (+5.3%))
- Detail modal shows spinner while fetching, then lists positions with symbol, instrument type, quantity, market value, and P/L

Reason
- Card click previously opened the edit modal, making it impossible to view portfolio performance without accidentally entering edit mode
- P/L percentage was already fetched (total_gain_loss_pct in PortfolioSummary) but never displayed
