# Investment loading and portfolio overview — 1.0.43

Prepared locally on 2026-10-06. These frontend changes do not modify Supabase or the Render backend and have not been deployed.

## Loading and cache

After authentication, Trackr requests the lightweight `/portfolios/count` endpoint to wake Render. Once the active profile's portfolios are available from Supabase, it requests backend summaries and queues all portfolio details for that profile. Core financial initialization continues independently. The visible portfolio moves ahead of queued background details; already running requests are reused.

`PortfolioDataStore` owns requests, validation, in-memory state and optional localStorage persistence. Entries are isolated by user/profile, expire after 24 hours (5 minutes for no open positions), and store summary, positions and history together. Valid expired data is immediately visible while being reloaded. Unavailable/full storage does not prevent loading. Authentication changes/logout remove private caches; ordinary startup preserves reusable entries.

Each backend request has a three-minute timeout for Render startup. Failures end loading and expose Retry; missing prices are not interpreted as an empty portfolio or persisted as valid totals. Changing profile or invalidating cancels queued/in-flight work and discards late results, including responses from transports that complete after cancellation.

The header Refresh button invalidates active-profile investment entries and requests, reloads Supabase and awaits summaries plus the portfolio currently open. Other details remain in the background queue. It preserves the session, settings, installed PWA assets and backend market caches. Successful investment writes invalidate the same cache; transaction deletion does so after the write completes.

## Overview semantics

The mobile view shows portfolio value and gain/loss, net capital, open positions and annual XIRR, followed by value/performance history, allocation by position/type and expandable position cards. Desktop uses a position table. Names/ISINs come from the user's accessible Supabase orders. Metadata failures preserve successfully retrieved prices but disable unverified currency-dependent history.

- Backend `portfolio_xirr` is a percentage; zero is preserved as a valid response value.
- Backend history dates use `DD-MM-YYYY`; the frontend normalizes and sorts them before plotting.
- The value curve includes changes caused by orders. The performance curve uses the backend NAV history and rebases it to zero at the beginning of the selected period. Ranges end on the most recent available historical date.
- Portfolios with `history_mode = positions_only` hide XIRR/performance and explain why.
- Allocation weights use market value only when holdings share one currency. History is shown only when all order currencies are verified and identical. Investment list totals are grouped by reference currency.
- `total_cost` and `avg_price` describe net capital in positions still open, subtracting sale proceeds. They are labelled as net capital/net average price, with an explanation, rather than remaining acquisition cost.
- “Loaded on” records the frontend request completion time. It does not claim that market quotes were updated at that time.

Render startup can still delay data when Investments is opened immediately. Preloading moves that wait earlier; it does not keep Render permanently running. Backend market-data freshness, multicurrency conversions/history correctness, owner/member authorization and XIRR calculation validity remain backend responsibilities; this release does not change their calculations or authorization rules.

## Local verification

All 30 frontend tests pass; lint has no warnings, the production build succeeds and the dependency audit reports zero vulnerabilities. The existing large-main-chunk build warning remains.

The frontend regression suite covers startup order, deduplication/queue priority, persistence/expiry, invalidation and late-response protection, user/profile boundaries, timeout/retry, missing prices (including gifted positions), missing portfolios, storage failure, order metadata, normalized dates/XIRR, allocation currency rules and performance rebasing. Component tests cover the overview, incomplete-history/privacy behavior and header refresh failure/recovery.

The overview was inspected in a local Chromium browser with synthetic data at 320/390 pixels, light/dark themes and desktop width 1280. Quote failure, mixed currency and incomplete history were also exercised; all scenarios had no horizontal page overflow or uncaught browser errors. Chart controls and expandable positions were checked. This does not benchmark real Render cold-start latency or verify production data.
