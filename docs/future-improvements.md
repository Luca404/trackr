Future improvements backlog
===========================

Updated on 2026-10-08 after implementing Render keepalive, publishing Trackr 1.0.43 and synchronizing the shared Supabase migration ledger. The user confirmed that the new investment view works, but reported long loading times. Trackr security, shared profiles and the investment frontend changes are implemented; backend performance work remains planned. Multicurrency is explicitly deferred.

Urgency order
-------------

Next backend performance task

- 4. Measure recap/detail latency and move portfolio summaries to a two-level caching model

High

- 6. Expand automated tests and runtime sanity checks for critical financial flows
- 3. Complete multi-profile support in portfolio-tracker

Medium

- 5. Unify authentication and configuration so pfTrackr behaves like a natural extension of Trackr
- 1. Introduce an integration layer between Trackr UI and portfolio-tracker backend
- 10. Extend history_mode gating to pfTrackr analytics (Trackr overview completed)
- 11. Allow editing detected accounts, portfolios, categories, and subcategories before Kakebo import
- 15. Generalize in-app notifications beyond recurring investment reminders

Lower

- 2. Clarify and clean up backend models/documentation in portfolio-tracker

Completed infrastructure

- 16. Render keepalive — active on hosted Supabase; automatic HTTP 200 verified on 2026-10-08

Deferred

- 8. Handle investment orders in currencies different from the linked cash account (multicurrency)

Priority rationale

- `16` implements an independent Supabase keepalive; see the operational status and verification in [the runbook](render-keepalive.md). It does not replace durable market-data caching.
- `6` now means extending the existing frontend/SQL/concurrency suite and testing the external portfolio integration, rather than introducing the first tests.
- `14` is completed on main; membership roles, invitation RPCs and security regression tests are already deployed.
- `3` is high because profile-boundary mistakes affect data correctness, not just architecture.
- `4` is high because portfolio summaries are core UX and current caching pushes too much correctness logic into the frontend.
- `5` and `1` matter a lot for product cohesion and maintainability, but they are less urgent than data-safety and correctness.
- `8` is deferred: multicurrency development is not part of main or the hosted security migrations.
- `10`: Trackr now consumes `history_mode`; the remaining work concerns other/backend analytics.
- `11` is medium because the current auto-detection flow is usable, but pre-import editing would materially improve control and migration quality.
- `15` is medium because the notification panel handles recurring investments and profile invitations; other notification types remain future work.
- `2` is still worth doing, but it is mostly cleanup/clarification unless it uncovers hidden runtime bugs.



## 16. Keep the Render backend active with an external cron

Priority: requested on 2026-10-06; implementation authorized on 2026-10-08.

Status: completed, deployed and active on 2026-10-08. Render serves the public health route; hosted Supabase has exactly one enabled `trackr-render-keepalive` job every 10 minutes. An automatic ping returned HTTP 200 without timeout/error. Operational verification, timings and pause/remove commands are in [the keepalive runbook](render-keepalive.md).

Goal

Reduce the cold start when Trackr opens, using a lightweight request every 10 minutes. The scheduler must run independently of the PWA, browser and the user's computer.

Implementation

- Added a public `GET /health` to the Render backend that returns HTTP 200 with `{"status":"ok"}` and `Cache-Control: no-store` without querying Supabase, requesting market prices or computing portfolios. It needs no user token or service key.
- Supabase Cron (`pg_cron`) plus `pg_net` schedules `trackr-render-keepalive` every 10 minutes. Extension availability and the absence of an equivalent job were checked first.
- HTTP timeout is bounded at 180 seconds for cold starts. Verify actual HTTP responses as well as cron execution, since enqueueing a request does not prove the backend answered.
- The runbook documents inspecting, disabling and removing the job. Migration `20261008120000` is mirrored in Trackr/FitTrackr; the linked dry-run showed only this new migration.
- Measure health/startup, recap and detail response times separately to establish which delays remain after keepalive is active.

Verified results and remaining limits

- A real automatic run returned the expected HTTP 200 response. The final job configuration is active with the requested 10-minute interval; the smoke run temporarily used a one-minute interval.
- The endpoint test passed without credentials and with outbound connections forbidden. The job invokes no portfolio calculations and stores no user credentials.
- The runbook records setup, observations and the pause/remove procedure; the shared migration is applied and both application ledgers are synchronized.
- Long-term uptime and app recovery after a future Render restart remain untested. Existing frontend cache/retry behavior is unchanged; recap/detail performance still needs separate measurement.

Hosting constraints

Render Free spins down after 15 idle minutes and grants 750 running-instance hours per workspace per calendar month. One service running continuously needs 720 hours in a 30-day month or 744 in a 31-day month; other Free services share the same allowance. Free services can still restart, and local filesystem changes are lost on spin-down/restart/redeploy. Keepalive therefore reduces cold starts but does not make the SQLite market cache durable. See [Render Free limits](https://render.com/docs/free) and [Supabase HTTP scheduling](https://supabase.com/docs/guides/database/extensions/pg_net).

Follow-up after keepalive

The frontend already requests the recap before background details. The backend recap currently calculates all portfolios before returning, and its pricing helpers can fetch historical prices even when the portfolio-history output is disabled. Under the default configuration, market caches are SQLite files on the backend. Item `4` remains the follow-up: persist market prices/portfolio summaries on Supabase, return the last available recap promptly and refresh expensive data separately. Runtime measurements must confirm the bottlenecks before changing calculations.

1. Introduce an integration layer between Trackr UI and portfolio-tracker backend

Priority
- Medium

Status
- Confirmed as a real problem

Problem
- In `trackr`, several React components and pages call the portfolio backend directly with `fetch`.
- The UI layer currently handles backend concerns such as URL construction, Supabase token retrieval, auth headers, query params, response mapping, local caching, and backend-specific error cases.
- This makes the boundary between `trackr` and `portfolio-tracker` blurry and spreads integration logic across the UI.

Current examples
- Portfolio summaries/details now use `portfolioApi` and `portfolioData` (1.0.43); remaining instrument lookup/import callers include:
- `src/components/transactions/TransactionForm.tsx`
- `src/components/KakeboImport.tsx`

Why this is a problem
- The same integration logic is duplicated in multiple places.
- Backend changes require touching several UI files.
- Cache, retry, timeout, logging, and normalization behavior are not centralized.
- Presentation components know too much about transport and backend details.

Intended direction
- Add a dedicated integration/service layer in `trackr` for all portfolio-backend interactions.
- Example API surface:
  - `getPortfolioSummaries(profileId)`
  - `getUcitsList()`
  - `searchStocks(query)`
  - `lookupIsin(isin)`
  - `lookupBond(isin)`
- React components should call semantic functions and stop dealing directly with auth, transport, and caching details.

Expected benefits
- Less duplication
- Cleaner separation of responsibilities
- Easier backend evolution
- More consistent error handling and caching
- Lower maintenance cost for investment-related flows

2. Clarify and clean up backend models/documentation in portfolio-tracker

Priority
- Lower

Status
- Confirmed as a real problem

Problem
- In `portfolio-tracker`, SQLAlchemy is still actively used for the local SQLite market-data cache.
- At the same time, the repository still contains several SQLAlchemy "business" models that no longer appear to be the source of truth for user data, because user-facing data is now handled primarily through Supabase.
- The current structure makes it hard to understand which models are runtime-critical, which are compatibility leftovers, and which are only reused indirectly for enums/types/shapes.

What is actually active
- SQLAlchemy + SQLite cache layer is active and needed.
- Cache models in `backend/models/cache.py` are part of the real runtime.
- `backend/utils/database.py` explicitly defines SQLite as cache-only storage.

What is unclear / likely legacy
- Non-cache models in `backend/models/` such as user/account/portfolio/transaction/category/order are no longer clearly positioned.
- Some may be unused or mostly legacy.
- Some are still referenced indirectly, for example for enums or type shapes.
- There is also schema/type drift between the current Supabase-based runtime and some frontend/backend type definitions, especially around `user_id` and related data shapes.

Why this is a problem
- The backend architecture is harder to understand than it should be.
- It is easy to modify or trust the wrong layer.
- Legacy-looking files still appear first-class in the project structure.
- The `README.md` currently presents these models as if they were still the main application data model.
- Inconsistent type definitions increase the risk of subtle bugs and make the real data model harder to reason about.

Intended direction
- Keep SQLAlchemy where it is truly needed: cache-related runtime behavior.
- Audit the non-cache SQLAlchemy models and remove the ones that are no longer needed.
- Reorganize or clearly label the ones that are still used indirectly.
- Align frontend/backend type definitions with the real Supabase data model, especially for UUID-based user identifiers and related schema shapes.
- Make the boundary explicit:
  - Supabase = source of truth for user/application data
  - SQLAlchemy/SQLite = local cache for market/pricing data
- Rewrite `portfolio-tracker/README.md` so it reflects the actual runtime architecture.

Expected benefits
- Clearer backend mental model
- Easier maintenance and onboarding
- Lower risk of editing the wrong abstraction
- Less confusion between active runtime code and historical leftovers

3. Complete multi-profile support in portfolio-tracker

Priority
- High

Status
- Confirmed as a real problem

Problem
- Multi-profile support was designed and implemented primarily in `trackr`.
- In `portfolio-tracker`, profile support exists only partially and was never fully designed as a first-class concept.
- This creates an inconsistency across the shared ecosystem: `trackr` is profile-aware by default, while `pfTrackr` is not yet fully profile-aware in backend flows and frontend UX.

Current situation
- `trackr` treats the active profile as a core part of the data model and user flow.
- `portfolio-tracker` has partial support for `profile_id`, but not a complete profile-first architecture.
- The portfolio frontend also lacks a proper settings area where profile-related controls could live.

Why this is a problem
- Data separation semantics are inconsistent between the two apps.
- Portfolio-related reads, aggregations, and actions may not be uniformly scoped to the intended profile.
- Users cannot manage portfolio-related profile behavior directly inside `pfTrackr`.
- The shared-database model becomes harder to reason about as the two apps evolve.

Intended direction
- Make profile support explicit and complete across `portfolio-tracker`.
- Audit backend portfolio endpoints and related flows to determine which ones must become profile-aware.
- Add a settings area in the `pfTrackr` frontend as the natural place for profile-aware preferences and account-level controls.
- Align the mental model across both applications so that profiles behave consistently in personal-finance and portfolio contexts.

Expected benefits
- More coherent cross-app user model
- Safer separation of portfolio data between profiles
- Better UX consistency between `trackr` and `pfTrackr`
- A clear place in `pfTrackr` for future settings and profile management features

4. Move portfolio summaries to a two-level caching model

Priority
- High

Status
- Confirmed as a real problem

Problem
- `trackr` currently keeps important portfolio summary data in frontend local cache (`localStorage`) to avoid expensive backend recomputation and repeated ticker/price fetching.
- This is reasonable for UX, but today the frontend cache is carrying too much responsibility: performance, fallback behavior, cache invalidation, and partial data reliability.

Current logic
- Portfolio prices and summaries are expensive to compute because they may require ticker lookups, scraping, cached history reads, and portfolio aggregation.
- Prices are typically daily, so a 24h cache window is a sensible optimization.
- Local cache is also useful to avoid immediate backend refetches when switching pages and returning to the portfolio screen.
- Since 1.0.43, one frontend queue loads recap first and details afterward; caches include summary, positions and history, with user/profile isolation and late-response protection. This does not introduce persisted backend summaries.
- The backend returns the recap only after all requested portfolios have been calculated. Pricing helpers may still fetch histories, and default SQLite caches can be lost on Render Free restart/spin-down. Keepalive (`16`) is now active and verified; durable caches and a fast recap remain this item’s scope.

Why this is a problem
- Frontend local cache is device-specific and not shared.
- Since 1.0.43, a shared frontend store owns summary/detail/history lifecycle, cancellation and refresh; centrally persisted backend summaries remain outstanding.
- Financial writes call shared invalidation; backend/DB invalidation across devices remains outstanding.
- The UI is compensating for backend cost/latency rather than consuming a stable summary layer.

Intended direction
- Keep local frontend cache, but reduce its role to UX/perceived-performance optimization.
- Introduce persisted or centrally managed portfolio summaries on the backend/DB side.
- Example direction:
  - a `portfolio_summaries` table or equivalent backend summary layer
  - fields such as `total_value`, `total_cost`, `total_gain_loss`, `positions_count`, `xirr`, `summary_updated_at`, `last_price_update`
  - support for `profile_id` where relevant
- Frontend should be able to:
  - show local cached data immediately
  - revalidate against backend summary data
  - rely on backend summaries as the main shared source of truth

Expected benefits
- Faster UX without losing local responsiveness
- Shared summary state across devices/sessions
- Simpler frontend invalidation logic
- A clearer separation between UX cache and authoritative summary data
- Less repeated expensive recomputation of portfolio-level metrics

5. Unify authentication and configuration so pfTrackr behaves like a natural extension of Trackr

Priority
- Medium

Status
- Confirmed as a real problem

Problem
- `trackr` and `pfTrackr` currently behave like two separate frontend applications from an authentication and configuration perspective.
- A user can already be logged into `trackr` and still be asked to log in again in `pfTrackr`.
- This breaks the intended product direction, where `pfTrackr` should feel like a natural extension of `trackr`, not a separate app.

Current situation
- `trackr` uses Supabase Auth client-side as its native session model.
- `pfTrackr` frontend manages its own token lifecycle with local storage and manual refresh behavior.
- `pfTrackr` backend exposes auth wrapper endpoints such as `/auth/login`, `/auth/register`, and `/auth/refresh`.
- Backend URLs and related config are also not fully centralized across the ecosystem.

Why this is a problem
- Users experience duplicated login flows.
- Authentication logic is duplicated across apps.
- Session persistence and refresh behavior are harder to reason about and maintain.
- The product feels fragmented even though the apps are part of the same ecosystem.
- Environment/config changes are more error-prone when backend endpoints are scattered or hardcoded.

Intended direction
- Align `pfTrackr` with the same session/auth model used by `trackr`.
- Move toward a shared authentication experience where `pfTrackr` can reuse the existing user session instead of behaving like a standalone app.
- Reduce or remove unnecessary auth-wrapper behavior if Supabase-native session handling is sufficient.
- Centralize portfolio-backend configuration so environment changes do not require edits in multiple UI files.
- Treat `pfTrackr` as an extension of the main product, not as an isolated frontend with parallel auth assumptions.

Expected benefits
- More seamless cross-app UX
- Fewer repeated login prompts
- Less duplicated authentication code
- Clearer session lifecycle across the ecosystem
- Easier config management across environments

8. Handle investment orders in currencies different from the linked cash account

Priority
- Medium

Status
- Confirmed as a future need

Problem
- Investment orders can refer to instruments quoted in a currency different from the cash account used to fund the transaction.
- The UI now reflects instrument currency correctly in the order form, but account-side cash movement and transaction accounting are still effectively treated as if they were in the same currency.

Why this is a problem
- The displayed order values can look correct while the linked account movement is financially ambiguous or wrong.
- Multi-currency portfolios and foreign stocks/ETFs become hard to reason about from the cash-account side.
- It is unclear where FX conversion should happen, which rate should be used, and what amount should be stored in the linked Trackr transaction.

Intended direction
- Define a clear model for cross-currency investment orders:
  - instrument currency
  - account currency
  - FX rate source and timing
  - stored transaction amount in account currency
- Make sure account balances, linked transactions, and portfolio orders remain coherent when currencies differ.
- Decide whether FX conversion is user-entered, auto-fetched, or both.

Expected benefits
- Correct cash-account behavior for foreign instruments
- Clearer accounting semantics between Trackr and portfolio orders
- Better support for real multi-currency investing flows

10. Use portfolio history_mode to gate analytics and incomplete-history UX

Priority
- Medium

Status
- Confirmed as a follow-up after the Kakebo import and portfolio-position flows

Problem
- Some portfolios are now intentionally created with `history_mode = positions_only`, for example:
  - Kakebo import in `Posizioni correnti` mode
  - manual portfolio creation with only current positions
- These portfolios do not have a full order ledger, so metrics such as `XIRR` and other full-history analytics can be misleading or invalid.

Current situation
- `history_mode` is now stored on `portfolios`.
- Creation flows already set it to:
  - `full_orders`
  - `positions_only`
- Since 1.0.43, the Trackr overview hides XIRR and performance for `positions_only` and explains incomplete history. Other/backend analytics still need equivalent handling.

Why this matters
- Users need a clear distinction between portfolios with full historical orders and portfolios that only represent current positions.
- Without this distinction, the app can show analytics that appear precise but are not semantically reliable.

Intended direction
- Use `history_mode` in portfolio UI and analytics decisions.
- Likely first steps:
  - hide or disable `XIRR` and similar full-history metrics for `positions_only`
  - show a lightweight badge/message such as `Incomplete history`
  - prevent misleading performance interpretations where historical cash flows are missing

Expected benefits
- More honest analytics
- Clearer portfolio semantics for users
- Better foundation for future performance reporting

11. Allow editing detected accounts, portfolios, categories, and subcategories before Kakebo import

Priority
- Medium

Status
- Confirmed as a useful follow-up after the first Kakebo import UX pass

Problem
- Kakebo import now detects accounts, portfolios, categories, and subcategories automatically, but the user cannot adjust them before import.
- This makes the flow fast, but rigid when source naming is not exactly what the user wants in Trackr.

Why this matters
- Users may want to rename accounts or portfolios before they are created.
- Users may want to adjust category or subcategory names before imported transactions are generated.
- A pre-import edit layer would reduce cleanup work after import and make migrations more intentional.

Intended direction
- Add a pre-import edit/mapping layer keyed by stable Kakebo IDs, not by names.
- Support editing at least:
  - accounts: name, icon
  - portfolios: name, icon, color
  - categories and subcategories: name
- Ensure later import steps consume the edited mapping rather than raw names from the source DB.

Expected benefits
- Better migration quality
- Less cleanup after import
- Safer renaming semantics because mapping stays tied to source IDs

6. Expand automated tests and runtime sanity checks for critical financial flows

Priority
- High

Status
- Trackr baseline completed in 1.0.41: eight frontend tests; 48 SQL assertions on the hosted schema fixture and 47 on the older local fixture; two concurrency checks; real local SDK/Auth and production browser smoke checks.
- Trackr 1.0.43 expands the frontend suite to 30 passing tests, covering the investment queue, cache/expiry, refresh/retry, profile/session isolation, metadata and mobile overview behavior.
- CI runs lint, tests, dependency audit, build and isolated PostgreSQL security/concurrency checks. See [release verification](security-fixes-2026-10-04.md).
- Earlier backend portfolio/order tests remain historical milestones; their current coverage needs a separate pfTrackr review.
- Remaining work: browser coverage for authenticated financial flows, external portfolio endpoints/math/pricing, broader Kakebo fixtures and multicurrency when resumed.

Problem
- SQL permissions, profile boundaries, invitation lifecycle, recurrence idempotency, linked-write rollback and export/import safeguards now have regression coverage.
- The external portfolio calculations and end-to-end UI/backend integration still need separate verification; passing Trackr checks does not establish their correctness.

Risk areas
- Portfolio position aggregation from orders
- Total cost / total value / gain-loss calculations
- XIRR and related performance metrics
- Stock split application
- FX conversions
- Price-fetch fallback behavior
- Import flows such as Kakebo
- Profile isolation in shared-data scenarios

Why this is a problem
- These areas are logic-heavy and sensitive to edge cases.
- A bug can produce plausible but incorrect financial data.
- Failures may remain unnoticed because the UI still renders "valid-looking" numbers.
- As `trackr` and `pfTrackr` become more integrated, regressions in one area can affect multiple user flows.

Intended direction
- Add a lightweight but high-value automated test strategy around critical business logic.
- Prioritize:
  - unit tests for pure or mostly pure financial calculations
  - integration tests for the most important backend routes and data flows
  - representative fixtures covering realistic portfolio scenarios
- Add runtime sanity checks/warnings for suspicious states, for example:
  - negative final holdings
  - selling more than current position
  - `total_value = 0` while `total_cost > 0`
  - missing `profile_id` in profile-sensitive flows
  - ambiguous FX conversion fallbacks

Suggested first test cases
- Single-buy ETF portfolio
- Portfolio with partial sell
- Stock with split adjustment
- Multi-currency portfolio with FX conversion
- Two separate profiles with no data leakage

Expected benefits
- Higher confidence in financial correctness
- Earlier detection of silent regressions
- Safer refactors in pricing and portfolio logic
- Reduced need to manually "trust" complex calculations

14. Shared-profile support with invitations and membership-based access control

Status
- Completed on main; security hardening deployed in 1.0.41.
- Settings manages profile invitations and owner/editor/viewer memberships; the notification panel supports accept/reject. Owners can cancel invitations and manage other members; non-owners can leave.
- RLS enforces member reads and editor/actual-owner writes. Direct invitation writes and owner promotion are restricted; RPCs handle recipient identity, rate limits and acceptance locking.
- Current implementation and tests: [security release record](security-fixes-2026-10-04.md). The April design/plan is historical and must not be replayed as current SQL.

15. Generalize in-app notifications beyond recurring investment reminders

Priority
- Medium

Status
- Confirmed as a useful follow-up now that a notification surface exists

Problem
- The current top-bar notification panel handles recurring investment reminders and incoming profile invitations.
- Future reminder and collaboration flows will need the same surface.

Why this matters
- Profile-sharing invitations already use this notification surface.
- Other future actions may also fit there:
  - import/share responses
  - pending confirmations
  - finance sanity warnings

Intended direction
- Extend the current bell panel beyond its existing investment and invitation types.
- Define notification types, payload shapes, and dismissal/completion semantics per type.
- Keep recurring investment completion as one notification class among several.

Expected benefits
- Reusable product surface for cross-feature reminders and actions
- Cleaner UX than adding one-off banners in several pages
- Better support for future profile-sharing flows
