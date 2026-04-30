# trackr — Known Issues & TODO

## Bugs

- **Black screen on SW update**: clicking "Ricarica" in the update banner occasionally turns the screen black. Root cause unknown.
- **Investment transaction edit opens ticker dropdown**: when editing an existing investment transaction, the symbol search dropdown opens automatically. Should only open on explicit user tap.
- **P/L overflow in portfolio list**: if P/L % is very large, the "PL (%)" label wraps leaving only the `€` symbol on the line above.
- **Strange scroll glitch**: scrolling in a specific way while switching pages can hide the fixed header bar. Difficult to reproduce reliably.
- **`touchmove` warning**: `[Intervention] Ignored attempt to cancel a touchmove event with cancelable=false` logged during page swipes. Low priority.
- **Chrome autofill bar**: Android Chrome shows a password/card autofill bar when the keyboard opens. Not fixable via HTML/CSS — it's native browser UI (`KeyboardAccessoryView`). Chrome ignores `autoComplete="off"` for this. User-side fix: disable autofill in Chrome settings.
- **Zombie session after DB user deletion**: if a user is deleted directly from Supabase auth.users, the app may not auto-logout because the local JWT is still valid. Not a real production issue (users aren't deleted directly from DB in practice).

## TODO

- **Category deletion with associated transactions**: blocks deletion if transactions exist (option a implemented). Still missing: prompt to reassign before deleting, or auto-assign to "Senza categoria". Fix in `confirmDeleteCategory` / `confirmDeleteSubcategory` in `CategoriesPage.tsx`.
- **pfTrackr account linkage**: when recording an order in pfTrackr, allow selecting a cash account so that a linked `investment` transaction is auto-created in Trackr (debiting the account). Creates a bidirectional order↔transaction link (currently only Trackr→pfTrackr).
- **Portfolio add button UX**: the "+" for adding a new portfolio is a dashed card at the bottom of the list. Consider moving to header or changing style.
- **Number format in placeholders**: some inputs (KakeboImport, InvestmentOrderForm) still use hardcoded "0.00" placeholders. Align all to user's selected decimal format.
- **Auto `risk_free_source` and `market_benchmark` defaults**: set sensible defaults when creating a new portfolio (currently saved as empty strings).
- **Calendar UX**: the date picker closes when changing month/year. Investigate replacing the native Android calendar with a custom one.
- **Balance graph — single transaction**: chart renders but a lone dot with no line is visually unclear. Decide how to handle this edge case.
- **Balance graph — mark investments**: investment transactions are not visually distinguished on the trend line (same dot color logic as income/expense).
