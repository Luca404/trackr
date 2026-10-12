# Investment price and total correction — 1.0.44

2026-10-12: the user reported a large difference between a portfolio's latest
chart value and its overview total, with all orders/reference amounts in EUR.
This is a price-selection bug, not a change to the P/L formula.

## Cause

The backend merged cached/new histories and sorted `DD-MM-YYYY` strings as text.
For example, `31-12-2025` sorts after `12-10-2026`. ETF pricing then selected the
last list entry as the current quote. The chart independently parses calendar
dates, so it could show the latest value while current totals used an old price.
The wrong `last_price` could also survive in SQLite and in the frontend's 24h cache.

## Correction

- Backend histories are sorted/deduplicated by parsed dates, including equivalent
  ISO/day-first dates and cases with only cached or only new data. The latest-date
  helper also works on unsorted legacy histories. This shared helper covers both
  prices and exchange rates.
- ETF cache reads recover `last_price` from the newest chronological EOD point.
  A repaired fresh cache is persisted without advancing its download timestamp.
  Both JustETF and yfinance refresh paths now select the newest merged quote.
- Trackr accepts persisted investment caches only with envelope revision 2.
  Entries from previous releases are discarded on access and fetched again;
  current cache TTL, user/profile boundaries, Auth, settings and PWA assets remain
  unchanged. No changes to orders, cashflows, user records or Supabase schema.
- Frontend release is 1.0.44. The fix must be deployed on Render before publishing
  the frontend cache invalidation, so new cache entries contain corrected quotes.
- Public `/health` keeps its tiny status response and optionally returns
  `X-Backend-Revision` from Render's public deployment SHA for verification.
  See [Render's default environment variables](https://render.com/docs/environment-variables).

## Verification

- Six initial backend regressions failed on the original implementation; all
  passed after correction. Full backend suite: 23 tests passed.
- The synthetic EUR fixture reproduces the reported shape: 100 units at the old
  quote 82.96 produced 8,296; at the newest quote 98.95 it produces 9,895. After
  repair, positions, total and final chart value agree, with net capital 8,000,
  P/L 1,895 and P/L percentage 23.6875%. These are test fixtures, not a production
  portfolio snapshot or an independent verification of the user's market value.
- Both ETF provider refresh paths and a fresh SQLite cache with a wrong stored
  `last_price` are covered. Health tests cover the optional revision header.
- Frontend: 31 tests passed, including rejection/refetch of legacy totals and
  preservation of auth/settings. Lint and production build passed. The existing
  roughly 796 KB main-chunk warning remains.
- Only currency/type metadata of the named portfolio was inspected through the
  linked database. No user orders were changed and no authenticated production
  portfolio response was obtained during diagnosis.

Deployment verification on 2026-10-12: Render `/health` returned HTTP 200 with
`X-Backend-Revision: a018a8dd11f0625d551498b6f1e5c180610b7fa6`, confirming
[the backend fix](https://github.com/Luca404/portfolio-tracker/commit/a018a8dd11f0625d551498b6f1e5c180610b7fa6)
was running before the frontend release was published. Trackr 1.0.44 is published
through main and the configured Vercel deployment; installed PWAs must accept
that update to use the new cache revision. The dependency audit reported zero
vulnerabilities. The authenticated user portfolio value remains to be checked
in the app after refresh.

## Using the corrected release

Accept the PWA update and reopen Trackr. On first access to an investment profile,
old investment caches are discarded automatically. The in-app refresh can also
refetch summaries and the opened portfolio. Quotes remain provider EOD prices;
the fix does not introduce intraday prices or durable backend market caching.
