# trackr — Known Issues & TODO

Reviewed for main 1.0.41 on 2026-10-04. UI/device issues below are previously reported and have not all been reproduced in this review. Applied security fixes and verification evidence are in [the security release record](security-fixes-2026-10-04.md).

## Bugs

- **Black screen on SW update**: clicking "Ricarica" in the update banner occasionally turns the screen black. Root cause unknown.
- **P/L overflow in portfolio list**: if P/L % is very large, the "PL (%)" label wraps leaving only the `€` symbol on the line above.
- **Strange scroll glitch**: scrolling in a specific way while switching pages can hide the fixed header bar. Difficult to reproduce reliably.
- **`touchmove` warning**: `[Intervention] Ignored attempt to cancel a touchmove event with cancelable=false` logged during page swipes. Low priority.
- **Chrome autofill bar**: Android Chrome shows a password/card autofill bar when the keyboard opens. Not fixable via HTML/CSS — it's native browser UI (`KeyboardAccessoryView`). Chrome ignores `autoComplete="off"` for this. User-side fix: disable autofill in Chrome settings.
- **Auth user deletion while a page is open**: local JWT/session state can remain until server validation or refresh. Cache cleanup on logout/identity changes is implemented; immediate logout after an administrative user deletion remains unverified. Removing an Auth user can cascade into both finance and fitness data in the shared project.
- **Production bundle size**: the main JS chunk is about 770 KB before compression; Vite warns above 500 KB. Consider route-level lazy loading. This is a performance issue, not a dependency advisory.
- **Historical fitness constraints**: some pre-existing fitness CHECK constraints remain `NOT VALID`. All seven new security constraints were validated; the older fitness checks need a separate integrity review.

## TODO

- **Category deletion with associated transactions**: blocks deletion if transactions exist (option a implemented). Still missing: prompt to reassign before deleting, or auto-assign to "Senza categoria". Fix in `confirmDeleteCategory` / `confirmDeleteSubcategory` in `CategoriesPage.tsx`.
- **pfTrackr account linkage**: when recording an order in pfTrackr, allow selecting a cash account so that a linked `investment` transaction is auto-created in Trackr (debiting the account). Creates a bidirectional order↔transaction link (currently only Trackr→pfTrackr).
- **Portfolio add button UX**: the "+" for adding a new portfolio is a dashed card at the bottom of the list. Consider moving to header or changing style.
- **Number format in placeholders**: some inputs (KakeboImport, InvestmentOrderForm) still use hardcoded "0.00" placeholders. Align all to user's selected decimal format.
- **Auto `risk_free_source` and `market_benchmark` defaults**: set sensible defaults when creating a new portfolio (currently saved as empty strings).
- **Calendar UX**: the date picker closes when changing month/year. Investigate replacing the native Android calendar with a custom one.
- **Balance graph — single transaction**: chart renders but a lone dot with no line is visually unclear. Decide how to handle this edge case.
- **Balance graph — mark investments**: investment transactions are not visually distinguished on the trend line (same dot color logic as income/expense).
- **Multicurrency**: development remains separate from main and is deliberately deferred; do not apply its schema to the shared hosted DB as part of these security fixes.

## Resolved

- Ticker search results are gated on input focus in the shared investment form; the earlier automatic-dropdown issue was addressed before this release.
- Viewer writes/deletes, profile/parent boundary bypasses, invitation lifecycle/rate limits, duplicate recurrence generation, partial linked financial writes, session cache leakage and unsafe empty imports were addressed in 1.0.41.
- GitHub Actions now runs frontend checks and isolated SQL security/concurrency tests; the dependency audit reports zero known vulnerabilities as of this release.
