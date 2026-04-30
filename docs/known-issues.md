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

- **Category deletion with associated transactions**: deleting a category leaves transactions with an orphaned `category` string. Options: (a) block deletion if transactions exist, showing count; (b) prompt user to reassign before deleting; (c) auto-assign to "Senza categoria". Same for subcategories. Fix in `confirmDeleteCategory` / `confirmDeleteSubcategory` in `CategoriesPage.tsx`.
- **Default category language**: default categories are created using `i18n.language` at first login. If the app language differs from browser language at that point, categories may be in the wrong language. Possible fix: dialog at first open asking for language before creating defaults, or rename defaults when user changes language.
- **pfTrackr account linkage**: when recording an order in pfTrackr, allow selecting a cash account so that a linked `investment` transaction is auto-created in Trackr (debiting the account). Creates a bidirectional order↔transaction link (currently only Trackr→pfTrackr).
- **Portfolio add button UX**: the "+" for adding a new portfolio is a dashed card at the bottom of the list. Consider moving to header or changing style.
- **Number format in placeholders**: align all input placeholders to use the user's selected number format (`.` or `,` as decimal separator).
- **Remove "Installa App" from settings**.
- **Auto-search valid ETFs**: automatic validation/search for inserted ETFs.
- **Auto risk_free_source and market_benchmark**: set these to sensible defaults for new portfolios automatically.
- **Calendar UX**: the date picker closes when changing date. Investigate replacing the native Android calendar with a custom one.
- **Balance graph edge cases**: decide how to show the balance trend graph when there's only one transaction. Mark investment transactions on the balance graph.

- Poi vorrei togliere la card "Installa l'app" nelle impostazioni (inutile lì in fondo), sempre per quanto riguarda le impostazioni le vorrei rendere più carine da pc, sempre da pc voglio la barra laterale di scorrimento in fondo alla pagina, non che fluttua a metà

- Ora invece nella pagina Recap voglio che il grafico Andamento saldo abbia una legenda dell'asse y più sensata, con step fissi in base ai valori min e max
