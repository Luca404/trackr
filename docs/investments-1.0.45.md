# Total portfolio overview — 1.0.45

Implemented on 2026-10-12. Clicking **Total investments** on the portfolio list
opens `/portfolios/total`, a protected overview of every portfolio in the active
financial profile. The eye toggle remains a separate action.

## Holdings and totals

- Reuses the single-portfolio mobile overview: value, net capital, P/L, position
  count, annual return, history, allocation and expandable holdings; desktop uses
  a table. Investment navigation remains selected on detail/total routes.
- The same ISIN, instrument type and native currency are merged across brokers,
  even with different broker tickers. Without an ISIN, exact ticker/type/currency
  is used. Different ISINs or currencies are never conflated.
- Quantities, market values and net capital are added. Net average price and
  P/L percentage are recalculated from those amounts. Current quote is weighted
  by quantity, preserving percentage-based bond quote units. Existing backend
  bond valuation limitations are unchanged.
- Holdings show their source portfolios. Expanded mobile rows show quantity and
  market value per broker, with links to individual portfolios; the desktop table
  includes the source links and quantities.
- Totals are grouped by portfolio reference currency; the page never adds EUR
  and USD amounts. Each currency section includes its relevant portfolios.
  One eye toggle masks all currency sections.
- The headline uses the sum of complete recaps while details load. Positions
  appear after every relevant detail is available; incomplete quote data never
  becomes a valid-looking partial grand total. Cached valid data can remain
  visible with its existing stale/error indication.

## History and return

- Value history sums portfolio curves within their common available coverage,
  forward-filling interior date gaps without extending an active portfolio beyond
  its available end date. Verified no-order portfolios contribute zero. A fully
  sold portfolio becomes zero on its last sale date when cashflows establish it.
- Combined performance uses each portfolio's previous value as its return weight.
  It is not an arithmetic average of portfolio returns. Missing/unverified history
  currency or insufficient return-curve coverage makes that chart unavailable.
- Combined XIRR is solved from all dated buy/sell cashflows, including commissions
  and fully sold instruments, plus the current total value. It is not an average
  of portfolio XIRRs. It requires full order history, cashflows in the same currency
  and a solvable root. A `positions_only` portfolio disables the performance view
  and annual return for its combined currency group.
- Per-instrument aggregate XIRR is not displayed: individual broker XIRRs cannot
  be averaged. The page explains overall return/history availability.

## Loading, cache and refresh

The page subscribes to the existing profile-scoped store and sequential detail
queue. No additional Render endpoint or duplicate page-owned backend request is
introduced. Existing background prefetch already prepares individual details.
The Supabase metadata request now also reads fields required for cashflows;
metadata failure preserves loaded quotes but can leave aggregate XIRR unavailable.

Cache envelope revision 3 refreshes old entries once to obtain cashflow metadata;
key prefixes, TTLs, Auth/settings and profile boundaries are unchanged. The aggregate
is derived from the current snapshot, not persisted in another cache. Profile/order
changes therefore use the existing invalidation. Refresh while this page is visible
waits for all displayed portfolios and releases the spinner on failure.

This release changes only the frontend. No Supabase migration, backend deployment
or financial write is needed.

## Verification

All 49 frontend tests passed, lint passed without warnings, the production build
succeeded, and the dependency audit reported zero vulnerabilities.

Regression coverage includes cross-broker merging and provenance, identity/type/
currency boundaries, quote units, recap/loading/error behavior, profile-ID filtering,
historical gaps/coverage/closed portfolios, capital-weighted return, cashflow XIRR,
metadata commissions, queue reuse and refresh of every visible detail. Component
tests cover navigation from the total card, broker links, separate eye actions,
quote failure/retry and shared privacy across currency sections.

The overview was checked in the local browser with synthetic data at 320/390 pixels
and desktop width 1280, including dark mode, expanding provenance and the return
chart. No horizontal overflow or console errors were observed. Production user
portfolio arithmetic is not independently verified by these synthetic checks.
The existing main-bundle size warning remains (about 807 KB before compression).
