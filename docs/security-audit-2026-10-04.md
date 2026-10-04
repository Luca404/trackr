# Audit Trackr e database condiviso — 4 ottobre 2026

> Questo documento descrive lo stato precedente ai fix. Per le modifiche e le verifiche successive vedere [security-fixes-2026-10-04.md](security-fixes-2026-10-04.md).

## Esito

La copia locale non è aggiornata. Le dipendenze dei branch remoti sono migliorate rispetto al checkout locale, ma le vulnerabilità più rilevanti riguardano le autorizzazioni nel database: **le policy installate consentono ai viewer di cancellare dati finanziari condivisi** e consentono di aggirare la protezione del profilo principale. Il `dev` remoto contiene lo sviluppo multivaluta non ancora pubblicato in `main`: l'assenza delle relative migrazioni nel database remoto è coerente con questo stato di sviluppo, non indica che il database sia indietro rispetto a `main`.

Sono stati verificati codice locale, differenze rispetto a GitHub, snapshot del `dev` remoto, lockfile di `main`, dipendenze npm e **schema `public` realmente installato su Supabase**, acquisito con un dump del solo schema. Per fitTrackr sono stati esaminati schema, migrazioni, autenticazione delle Edge Functions e interazioni con il progetto condiviso; non è un audit completo del suo frontend.

Non sono state eseguite scritture, exploit, importazioni o migrazioni sul database remoto. “Confermato nello schema live” significa che la configurazione vulnerabile è presente nel dump corrente e che l'effetto segue dalle regole PostgreSQL; non significa che siano state cancellate o modificate righe per dimostrarlo.

## 1. Stato Git e compatibilità

| Riferimento | Commit | Stato |
| --- | --- | --- |
| Trackr checkout `dev` | `aa1d5cd8e8f3cf875720b6fe5251f3b5175b07aa` | Pulito prima dell'audit; 45 commit indietro rispetto a `origin/dev` |
| Trackr `origin/dev` | `be8fb03cd16c830b45a380fe4f03e8a8d4abf085` | Ultimo commit del 15 settembre 2026 |
| Trackr `main` locale | `2675584` | 36 commit indietro rispetto a `origin/main` |
| Trackr `origin/main` | `e194dbb9294a917b78447b192162472bfe8adaee` | Ultimo commit del 15 settembre 2026 |
| fitTrackr checkout e `origin/main` verificato live | `89aa9a285b8b974d346c158817e335670fdcba67` | Allineati; checkout pulito |

Eseguito `git fetch origin --prune` per Trackr. Il codice locale non è stato aggiornato con pull, merge o checkout. `origin/main` e `origin/dev` divergono: 1 commit esclusivo di main e 14 esclusivi di dev. Il commit di sicurezza di main è distinto da quello di dev; le patch alle dipendenze sono presenti su entrambi.

Tra gli aggiornamenti mancanti localmente: profili condivisi con owner/editor/viewer, dettaglio portafogli, correzioni alle date, layout desktop, multivaluta e test automatici. La versione dichiarata passa da 1.0.30 a 1.0.39, ma il dev contiene anche cambiamenti multivaluta successivi alle note della release.

### Aggiornamento locale: due vincoli da rispettare

1. Il client remoto legge `VITE_SUPABASE_PUBLISHABLE_KEY`; il `.env.local` attuale contiene ancora `VITE_SUPABASE_ANON_KEY`. La chiave verificata è già una publishable key: va aggiornato il nome della variabile senza pubblicarne il valore.
2. Solo il dev remoto richiede `account_currencies`, `transactions.currency`, `transactions.base_amount`, `transfers.from_currency`, `transfers.to_currency` e `transfers.to_amount`: **tutti assenti nello schema live**. `main` non richiede questi oggetti. Le migrazioni esistono come SQL nei documenti di pianificazione, non come migrazioni Trackr versionate. Un build riuscito non rileva questa incompatibilità del codice in sviluppo.

Un eventuale `git pull --ff-only origin dev` può allineare il checkout, ma per eseguire il codice multivaluta occorre un database di sviluppo con il relativo schema. Per aggiornare ed eseguire `main` non occorrono migrazioni multivaluta. La mancanza di quelle migrazioni sul remoto non è un motivo per applicare adesso una funzionalità ancora in sviluppo al database condiviso.

## 2. Architettura e confini del database condiviso

Trackr è una SPA React 18/TypeScript, costruita con Vite e installabile come PWA. Il client accede direttamente a Supabase Auth e PostgREST; le autorizzazioni effettive devono quindi essere nelle policy RLS e nelle RPC. `ProtectedRoute`, pulsanti nascosti e controlli TypeScript non impediscono richieste dirette alle API.

Le letture e scritture passano soprattutto da `src/services/api.ts`; `DataContext` conserva dati in memoria e calcola i saldi. Le operazioni finanziarie composte vengono generalmente eseguite con richieste separate. L'import Kakebo è l'eccezione: usa una RPC transazionale. Il backend pfTrackr è esterno alla repository e riceve il JWT Supabase per i riepiloghi.

È stato verificato, senza stampare credenziali, che Trackr e fitTrackr sono entrambi collegati via Supabase CLI al progetto remoto **`nitbisweytddtigoebeh`**. Il dump live proviene da quel progetto, usando `supabase db dump --linked --schema public`. I `.env.local` dei due frontend puntano invece a `127.0.0.1`: il precedente confronto degli URL riguardava quindi l'ambiente locale, non l'endpoint remoto. Le 30 tabelle nello schema `public` remoto hanno tutte RLS abilitata. Questo è un buon punto di partenza, ma le policy possono comunque essere troppo permissive.

fitTrackr usa tabelle distinte (`user_health_profiles`, `user_goals`, `meals`, `meal_entries`, `meal_items`, `dishes`, `pantry_items`, `prepared_batches`, tabelle palestra, ecc.) nello **stesso schema `public`**, non in uno schema SQL `health`. I dati fitness sono prevalentemente autorizzati per `auth.uid()`, mentre quelli finanziari sono autorizzati per appartenenza a un profilo.

La condivisione di un profilo finanziario non dovrebbe concedere accesso ai dati fitness. La cancellazione di `public.profiles` riguarda le relazioni finanziarie; non equivale a cancellare `auth.users`. La cancellazione di un utente Auth, invece, può propagarsi tramite cascade ai dati di entrambe le app. Auth, ruoli, privilegi dello schema, chiavi amministrative e cronologia delle migrazioni sono infrastruttura comune.

fitTrackr versiona una baseline `20260403160154_shared_project_baseline.sql` che è solo un marcatore della migrazione finanziaria già applicata: **non contiene lo schema Trackr**. Nessuno dei due checkout fornisce oggi una ricostruzione completa e affidabile dello schema finanziario corrente dai soli file Git.

## 3. Vulnerabilità e autorizzazioni da correggere

Priorità: **P1** = intervenire prima delle prossime modifiche/deploy; **P2** = intervenire dopo i difetti di autorizzazione. La gravità descrive l'effetto nel progetto, distinta dalla severity assegnata da npm.

### S1 — P1 / alta: un viewer può cancellare e spostare dati finanziari

**Confermato nello schema live.** Evidenza: [schema remoto, policy `members_all`](security-audit-2026-10-04/schema-remoto-public.sql#L3216).

Le policy `members_all` su accounts, categories, portfolios, transactions, transfers, recurring_transactions e, tramite i parent, orders/subcategories hanno questa struttura:

```sql
USING (is_profile_member(profile_id, auth.uid()))
WITH CHECK (... role IN ('owner', 'editor'))
```

Si applicano a tutte le operazioni. Per DELETE PostgreSQL valuta `USING`, non `WITH CHECK`: il viewer è un membro e può cancellare. La SELECT dello stesso oggetto è consentita, quindi anche DELETE con filtro o RETURNING ha la visibilità richiesta. Cancellare un parent può inoltre attivare i cascade delle tabelle figlie.

Anche UPDATE è problematico: `USING` autorizza la riga originaria in un profilo dove l'utente è viewer; `WITH CHECK` considera la riga risultante. Cambiando `profile_id` verso un proprio profilo dove è owner/editor, il controllo può passare. Lo stesso modello si applica ai parent di ordini e sottocategorie.

**Fix:** policy separate per operazione. SELECT per i membri; DELETE e `USING` di UPDATE per owner/editor; `WITH CHECK` di INSERT/UPDATE per owner/editor. Impedire inoltre modifiche arbitrarie ai campi di appartenenza o gestire gli spostamenti in una RPC dedicata. Rimuovere la vecchia policy ALL: aggiungere una policy più stretta senza rimuoverla non basta.

**Validazione necessaria:** owner/editor/viewer/non-membro per SELECT, INSERT, UPDATE e DELETE su tutte le otto famiglie di oggetti; includere spostamenti tra profili, cambio dei parent e cascade. [Semantica ufficiale PostgreSQL](https://www.postgresql.org/docs/current/sql-createpolicy.html).

### S2 — P1 / alta per integrità: policy storica aggira la protezione del profilo principale

**Confermato nello schema live.** Evidenza: [policy `own data`](security-audit-2026-10-04/schema-remoto-public.sql#L3279) e [policy `profiles_delete`](security-audit-2026-10-04/schema-remoto-public.sql#L3391).

`profiles_delete` richiede `user_id = auth.uid()` e `id <> user_id`, ma resta una policy ALL `own data` con `id = auth.uid()`. Le policy permissive sono combinate con OR: la policy storica autorizza proprio il profilo principale che l'altra voleva proteggere.

La stessa policy consente UPDATE del profilo principale mantenendo il suo `id`, senza imporre l'immutabilità di `user_id`; quest'ultimo determina ownership, riparazione membership e autorizzazione della RPC di import. L'UI invia solo `name`, ma l'API della tabella permette richieste dirette su altri campi.

**Fix:** eliminare `own data`, definire le sole operazioni previste, rendere immutabili `id` e `user_id` per i client e mantenere il vincolo sul profilo principale in DELETE. Verificare sia la proprietà in `profiles` sia il ruolo in `profile_members`.

Impatto principale sui dati finanziari del profilo, non una cancellazione automatica dei dati fitness. [Combinazione OR delle policy permissive](https://www.postgresql.org/docs/current/sql-createpolicy.html#SQL-CREATEPOLICY-MULTIPLE).

### S3 — P1 / alta per integrità: relazioni finanziarie non vincolate al profilo

**Confermato nello schema live.** Evidenza: [foreign key finanziarie](security-audit-2026-10-04/schema-remoto-public.sql#L3083) e policy S1.

Le policy controllano il profilo della riga, ma non che `account_id`, gli account dei trasferimenti, `recurring_id` e la transazione collegata a un ordine appartengano allo stesso profilo. Le FK verificano l'esistenza degli ID, senza vincolo composto sull'appartenenza.

Un owner/editor del proprio profilo può quindi costruire riferimenti verso ID di altri profili, anche quando non può leggere le righe collegate. Gli account hanno ID numerici. Una transazione così creata può, per esempio, impedire la cancellazione dell'account referenziato perché la FK transactions→accounts non usa cascade. La disponibilità e l'integrità sono a rischio; non è stata dimostrata una lettura dei dati altrui.

Le policy member-based inoltre non verificano l'attribuzione di `user_id`: un client può specificare un altro utente esistente. Le query del progetto che usano ancora `user_id` anziché il profilo rendono questa incongruenza rilevante.

**Fix:** FK composte e/o trigger che impongano account/profilo e ordine/portfolio/transazione coerenti; definire il significato di `user_id` nei profili condivisi, assegnarlo sul server e impedirne cambi arbitrari. Verificare le righe pregresse prima di validare nuovi vincoli.

[PostgreSQL documenta che i controlli di integrità referenziale bypassano RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

### S4 — P1 / media: revoca e rifiuto degli inviti non funzionano come previsto

**Confermato nello schema live e nel client remoto.** Evidenza: [policy `cancel_own_invitation`](security-audit-2026-10-04/schema-remoto-public.sql#L3179); `api.ts` remoto, `cancelInvitation` e `rejectInvitation`.

La policy UPDATE specifica solo `USING (invited_by = auth.uid() AND status = 'pending')`. In assenza di un `WITH CHECK` esplicito PostgreSQL riutilizza quell'espressione per la riga nuova. Il cambio `pending → cancelled` viene quindi rifiutato. Il destinatario ha una policy SELECT, ma nessuna UPDATE che autorizzi `pending → rejected`.

Un invito che l'owner vuole revocare può quindi restare accettabile fino alla scadenza. `accept_profile_invitation` non blocca inoltre la riga con `FOR UPDATE`: dopo aver corretto la revoca, va prevenuta una race fra accettazione e annullamento.

**Fix:** RPC di annullamento/rifiuto che controllino mittente/destinatario, stato e scadenza e modifichino solo lo stato; lock sulla riga anche in accettazione. Testare revoca effettiva, replay e accettazione concorrente alla revoca.

### S5 — P2 / media: percorso diretto agli inviti aggira i controlli della RPC

**Confermato nello schema live.** Evidenza: [policy INSERT sugli inviti](security-audit-2026-10-04/schema-remoto-public.sql#L3365) e [RPC di creazione](security-audit-2026-10-04/schema-remoto-public.sql#L555).

La RPC limita a 10 inviti/ora e controlla membership e duplicati, ma `authenticated` ha INSERT diretto e la policy verifica soltanto che il chiamante sia owner di `profile_id`. Il client può evitare la RPC, inserire inviti senza quei controlli e specificare `invited_by`, scadenza e stato. Il limite applicativo non protegge quindi tutte le vie di scrittura.

La protezione anti-enumerazione è incompleta: la RPC crea una riga visibile al mittente solo se l'email esiste; per email inesistenti ritorna senza incrementare il conteggio. L'esito è deducibile osservando gli inviti, anche se il valore restituito dalla RPC è sempre void.

**Fix:** riservare le scritture degli inviti a RPC controllate, revocare i grant diretti pertinenti e implementare un contatore che includa tutti i tentativi. Definire se la scoperta dell'esistenza di un account sia accettabile nel prodotto; se non lo è, rendere uniforme anche lo stato osservabile.

### S6 — P2 / media-bassa: helper di appartenenza interrogabili anonimamente

**Confermato nello schema live.** Evidenza: [helper](security-audit-2026-10-04/schema-remoto-public.sql#L1106) e [grant](security-audit-2026-10-04/schema-remoto-public.sql#L3573).

`is_profile_member(profile_id, user_id)` e `is_profile_owner(profile_id, user_id)` sono SECURITY DEFINER, accettano entrambi gli ID dal chiamante e hanno EXECUTE per `anon`. Chi dispone degli UUID può interrogare le relazioni di membership senza essere membro. Non è una lettura dei dati finanziari o fitness e gli UUID non sono facilmente enumerabili, ma è una divulgazione non necessaria.

**Fix:** helper in schema non esposto o senza grant anonimi/PUBLIC, con identità ricavata da `auth.uid()` dove possibile. Verificare che continuino a funzionare nelle policy.

### S7 — P2 / hardening: privilegi e funzioni SECURITY DEFINER troppo ampi

**Confermato nello schema live.** Sette funzioni SECURITY DEFINER non fissano `search_path`: accept_profile_invitation, create_profile_invitation, get_my_profiles, handle_new_user, is_profile_member, is_profile_owner e repair_own_membership. La RPC di import e il trigger fitness adjust_prepared_batch_remaining fissano invece `search_path`.

I privilegi predefiniti concedono ALL sulle nuove tabelle e funzioni public anche ad `anon`/`authenticated`. Le tabelle esistenti hanno RLS, ma un nuovo oggetto creato senza policy o senza verifica dell'identità può diventare esposto. Non è stato dimostrato un exploit di search_path con i privilegi attuali.

**Fix:** search_path esplicito e riferimenti qualificati, EXECUTE solo ai ruoli necessari e revisione dei default grant condivisi. Ogni cambiamento di default privilege riguarda anche le future migrazioni fitTrackr: non revocare indiscriminatamente l'accesso necessario alle RPC fitness.

[Indicazioni Supabase per SECURITY DEFINER e privilegi](https://supabase.com/docs/guides/database/functions).

### S8 — P2 / media per integrità: correlazione RLS errata nei meal_items di fitTrackr

**Confermato nello schema live.** Evidenza: [policy `own meal_items`](security-audit-2026-10-04/schema-remoto-public.sql#L3331). Sorgente: `../fitness-tracker/supabase/migrations/20260914160000_add_meal_entries.sql`, righe 65 e 71.

La sorgente scrive `e.meal_id = meal_id` senza qualificare la colonna esterna. Il dump live mostra che PostgreSQL l'ha risolta come `e.meal_id = e.meal_id`: il confronto è tautologico. La policy verifica il proprietario dell'entry, ma non che `meal_items.meal_id` coincida con il pasto dell'entry. Le due FK sono indipendenti.

**Fix nel progetto fitTrackr:** qualificare esplicitamente `meal_items.entry_id` e `meal_items.meal_id` e aggiungere un vincolo composto entry/pasto, oppure eliminare la ridondanza se compatibile con tutte le query. Testare richieste dirette alla tabella con entry propria e meal di un altro utente. Non è stata dimostrata l'esposizione di pasti preesistenti altrui; il difetto riguarda la creazione di relazioni incoerenti.

### S9 — P2 / hardening frontend: dati persistenti e confini della sessione

**Presente localmente e nel dev remoto.** Riferimenti: `AuthContext.tsx:35`, `DataContext.tsx:135` e `:261` locali; `PortfoliosPage.tsx:66`.

Il JWT è duplicato nelle chiavi `access_token` e `authToken`, oltre alla persistenza del client Supabase. I riepiloghi finanziari sono salvati in `pf_summaries_cache` senza user/profile nella chiave e non vengono cancellati da `clearCache` al logout. Sono anche stampati in console. Le richieste di DataContext non hanno un controllo della sessione/profilo al momento di applicare il risultato: una risposta iniziata prima del cambio può ripopolare dati del contesto precedente.

`vercel.json` non dichiara CSP, frame-ancestors/X-Frame-Options, X-Content-Type-Options o Referrer-Policy. Questo è un gap nel deployment configurato, non prova degli header effettivi erogati da Vercel. Non sono stati trovati sink evidenti `dangerouslySetInnerHTML`, eval o innerHTML nel codice applicativo; localStorage da solo non dimostra XSS.

**Fix:** rimuovere duplicazioni del token non utilizzate, cache per user/profile con cancellazione al logout e alla revoca, invalidazione delle richieste per identità/profilo e nessun log dei dati finanziari. Preparare CSP compatibile con script/style inline, WASM, service worker e gli endpoint effettivi; verificare gli header della build deployata.

## 4. Audit delle dipendenze

Audit eseguiti contro il registro npm il 4 ottobre 2026. I conteggi rappresentano **pacchetti segnalati**, comprendono dipendenze transitive e non sono il numero di exploit distinti.

| Snapshot | Audit completo | Produzione (`--omit=dev`) |
| --- | --- | --- |
| Locale aa1d5cd | 25: 15 high, 7 moderate, 3 low, 0 critical | 4: 1 high, 3 moderate |
| Remoto dev be8fb03 | 6: 5 high, 1 low, 0 critical | 0 |
| Remoto main e194dbb | 6: 5 high, 1 low, 0 critical | 0 |

Zero segnalazioni npm in produzione non certifica la sicurezza delle policy, del codice applicativo o del backend. Le “dipendenze produzione” includono anche pacchetti per Node che potrebbero non essere presenti nel bundle browser.

### Copia locale

- **Vite 7.3.1 — high:** lettura arbitraria di file tramite il WebSocket del dev server e altri bypass. `server.host = '0.0.0.0'` rende concreta la condizione di esposizione alla rete; la raggiungibilità dipende dalla rete/firewall. Il remoto usa 7.3.6. Correggere la versione locale e limitare il bind alla loopback quando l'accesso da altri dispositivi non serve. [Advisory del maintainer](https://github.com/vitejs/vite/security/advisories/GHSA-p9ff-h696-f583).
- **react-router-dom/react-router 6.30.3 e @remix-run/router 1.23.2 — moderate:** redirect/XSS e altri advisory. Le rotte esaminate usano prevalentemente percorsi costanti; non è stata trovata una catena applicativa che sfrutti input dell'attaccante. Il remoto usa React Router 7.18.3. [Advisory del maintainer](https://github.com/remix-run/react-router/security/advisories/GHSA-jjmj-jmhj-qwj2).
- **ws 8.19.0 — high:** disclosure/DoS; dipendenza transitiva Supabase usata sul lato Node. Non equivale a una falla WebSocket del browser React. Assente dai lockfile remoti.
- **PostCSS 8.5.6 e toolchain:** advisory su letture di file, DoS e trasformazione di input malevoli; remoto PostCSS 8.5.28. Il dettaglio completo delle 25 segnalazioni è in `security-audit-2026-10-04/npm-local.json`.

### Segnalazioni ancora presenti sui due branch remoti

- **braces 3.0.3 — high**, propagata a chokidar, micromatch, fast-glob e tailwindcss: 5 pacchetti segnalati, stessa catena principale. Il rischio riguarda pattern profondamente annidati nella toolchain, non cinque vulnerabilità runtime indipendenti. La build usa pattern controllati nel repository: sfruttabilità via UI non riscontrata. L'advisory non indica una versione braces corretta. `npm audit` propone anche un passaggio a Tailwind 4, che richiede migrazione e verifica; evitare un `npm audit fix --force` indiscriminato. [Advisory e stato della patch](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- **serialize-javascript 7.1.1 — low:** regressione XSS serializzando funzioni con sorgente controllata dall'attaccante; fix in **7.1.2**. Dipendenza di sviluppo della generazione PWA, non una XSS riprodotta in Trackr. L'override `>=7.0.3` permette versioni corrette, ma il lock resta sulla versione vulnerabile. Aggiornare il lock in una modifica mirata e verificare build e service worker. [Advisory del maintainer](https://github.com/yahoo/serialize-javascript/security/advisories/GHSA-gfhx-hw2g-v5hg).

Gli advisory residui sono successivi ai commit di sicurezza del 15 settembre: il titolo “eliminate npm security vulnerabilities” non garantisce lo stato del progetto oggi.

## 5. Integrità, affidabilità e manutenibilità

### I1 — P1: ricorrenze non atomiche e non idempotenti

`api.ts:729` locale e `:902` remoto: lettura delle regole scadute, INSERT delle transazioni e avanzamento della regola sono operazioni separate. Non c'è un vincolo UNIQUE su `(recurring_id, date)`. Due dispositivi possono creare le stesse occorrenze; un errore dopo un inserimento può duplicare le righe al tentativo successivo. L'errore nell'UPDATE finale di `next_due_date` non viene verificato.

**Fix:** RPC transazionale con lock sulla regola, chiave univoca/idempotenza e avanzamento soltanto al completamento. Testare concorrenza, retry e guasti parziali. È soprattutto un difetto di integrità finanziaria, non una lettura non autorizzata.

### I2 — P1: investimenti e cancellazioni composte possono lasciare dati parziali

`TransactionsPage.tsx:184` locale crea la transazione e poi l'ordine, in alcuni percorsi senza await e con `.catch(console.error)`. La cancellazione può continuare dopo il fallimento dell'eliminazione dell'ordine. `deletePortfolio` esegue cancellazioni separate. I percorsi principali restano nel dev remoto.

**Fix:** RPC transazionali per creazione/modifica/cancellazione di transazione+ordine e per cancellazione del portfolio; UI aggiornata soltanto dopo esito completo. Non riutilizzare la RPC di import, che sostituisce un profilo intero.

### I3 — P1: backup incompleto

`api.ts:1046` locale e `:1242` remoto esportano transactions, categories, accounts e portfolios, ma omettono transfers, orders e recurring_transactions. Nel dev le account_currencies sono incluse come oggetti annidati negli accounts, con ID, valuta e saldo iniziale; questo non compensa le entità mancanti. Profili, membership/inviti e un percorso di restore del formato JSON non sono inclusi: il backup non è una copia ripristinabile di tutto il modello relazionale.

**Fix:** specificare cosa significa “backup completo”, includere tutte le entità del profilo, versione e relazioni, e verificare un round-trip su un database isolato. Non usare l'export corrente come unica protezione prima di migrare.

### I4 — P2: profilo e cache non sempre coerenti

`getFreeOrders` filtra per `user_id` e `transaction_id IS NULL`, non per i portafogli del profilo attivo. È presente in locale e remoto: può mostrare quote gratuite di altri profili dello stesso utente e omettere quelle create da altri membri del profilo condiviso. `processRecurringTransactions` filtra ancora per user_id, un modello non coerente con i profili condivisi.

Le UPDATE/DELETE del service spesso filtrano solo per ID: le RLS devono proteggerle, mentre aggiungere il profilo attivo può prevenire errori del client. Il guard `isFetchingRef` evita richieste concorrenti, ma può anche scartare il reload di un cambio profilo mentre la richiesta precedente è in corso. Servono identità/profilo catturati per richiesta e invalidazione dei risultati obsoleti.

### I5 — P2: import e validazione

L'import SQLite legge l'intero file e usa query sincrone sul thread principale senza limite esplicito alla dimensione o al numero di righe: un file molto grande può bloccare la UI. Non è stata dimostrata una SQL injection; le query sono costanti e sql.js opera nel browser.

La RPC di import autentica e verifica l'owner del profilo, e usa una transazione: sono protezioni corrette. Tuttavia `{}` viene interpretato come array vuoti e può svuotare il profilo; introdurre validazione dello schema e un contratto esplicito per eventuali import vuoti. La RPC non ha un limite applicativo al numero di oggetti. Le quantità/prezzi/importi finanziari hanno pochi vincoli server; i numeri TypeScript o i campi UI non sostituiscono controlli PostgreSQL su domini, finitezza e segni ammessi per ogni tipo di operazione.

### I6 — P2: qualità e test

| Verifica | Esito |
| --- | --- |
| Build checkout locale | PASS, Vite 7.3.1 |
| Lint checkout locale | Non parte: dipendenze ESLint mancanti; viene trovato ESLint di sistema 6.4.0 |
| Test checkout locale | Script/suite assenti |
| Build dev remoto in snapshot isolato, con npm ci | PASS, Vite 7.3.6 |
| Test dev remoto | **23 test PASS in 2 file** |
| Lint dev remoto con dipendenze corrette | **151 errori, 15 warning**, 23 file con errori |

Il lint remoto rileva soprattutto 68 no-explicit-any, 28 set-state-in-effect, 25 variabili inutilizzate e 16 blocchi vuoti. Sono difetti di qualità e controlli da risolvere/configurare consapevolmente, non 151 vulnerabilità.

I test remoti verificano conversioni e saldi. Mancano test per RLS, ruoli condivisi, ricorrenze concorrenti, atomicità e backup. Trackr non contiene una workflow CI versionata; fitTrackr sì. Entrambe le build Trackr segnalano un chunk JS grande: circa 679 kB locale e 785 kB remoto minificati. Valutare lazy loading delle pagine e dell'import; non è una vulnerabilità.

Lo snapshot remoto non contiene `.git`: il plugin versione stampa un messaggio Git e usa il fallback previsto. Questo non ha causato fallimenti di build/test. Le verifiche statiche/build non hanno aperto sessioni utente né testato l'app contro il database live.

## 6. Percorso di correzione compatibile con fitTrackr

1. **Correggere S1–S4 nel database finanziario**, in una migrazione mirata e riproducibile, con test su owner/editor/viewer e utenti distinti. Includere vincoli di appartenenza, senza modificare le policy delle tabelle fitness.
2. **Correggere S8 da fitTrackr**, con la sua migrazione e test entry/pasto. Non riscrivere o riapplicare vecchie migrazioni già pubblicate.
3. **Formalizzare ownership delle migrazioni del progetto condiviso**: identificatori globalmente unici, storico comune, baseline coerenti e modifica mirata dei soli oggetti posseduti dall'app. Una baseline segnaposto non ricostruisce la finanza su un database vuoto.
4. **Quando si riprenderà lo sviluppo multivaluta, preparare e testare la migrazione Trackr su un database di sviluppo**, correggendo anche le policy proposte per account_currencies: il piano le concede a tutti i membri, viewer compresi. Le policy proposte non sono ancora installate; non servono per aggiornare `main` e non vanno applicate al remoto solo per allinearlo a un branch in sviluppo.
5. **Allineare checkout, nome della variabile env e dipendenze**, tenendo presente la divergenza main/dev. Aggiornare serialize-javascript e definire una soluzione compatibile per la catena braces/Tailwind. Il bind del dev server locale richiede attenzione fino all'aggiornamento di Vite.
6. **Rendere atomiche/idempotenti le scritture finanziarie e completo il backup**, poi aggiungere controlli CI e risolvere il lint.
7. **Hardening condiviso dei grant/RPC e delle sessioni**, verificando che fitTrackr continui a usare Auth, onboarding, pasti, dispensa e palestra.

Per ogni migrazione remota: review dello schema acquisito e del dry-run, applicazione dei soli cambi previsti, verifica dei due frontend. Come richiesto da `../fitness-tracker/AGENTS.md`, **mai `supabase db reset --linked`**. Questo audit non ha eseguito alcun push o reset.

## 7. Evidenze e limiti

Le evidenze riproducibili sono nella cartella [security-audit-2026-10-04](security-audit-2026-10-04/): dump del solo schema live, sei report npm (completi e produzione), output build/test remoti e dettaglio JSON del lint. Il dump non contiene righe degli utenti o dati personali.

La scansione mirata dei file Trackr versionati non ha rilevato private key, token GitHub, access key AWS, JWT o chiavi Supabase secret; nella cronologia non sono emersi file `.env`, `.pem` o `.key`. Non equivale a una scansione esaustiva di tutti i contenuti di tutti i commit. La publishable key del browser non è un segreto amministrativo.

Non sono stati verificati: backend Python pfTrackr esterno, stato del deploy Vercel, header HTTP live, configurazione Auth remota/password/MFA, bucket Storage, codice effettivamente deployato delle Edge Functions, grants fuori da `public`, contenuto delle righe esistenti, eventuali abusi pregressi. I parametri Auth nei config.toml locali non sono prova della configurazione di produzione.

Le Edge Functions fitTrackr esaminate validano l'utente via Supabase Auth; le chiavi amministrative sono server-side e la conferma barcode richiede un token HMAC legato a utente/barcode. Non è stata riscontrata una via dal ruolo finanziario condiviso verso i dati fitness. Lo schema comune resta un confine operativo da rispettare durante ogni fix.
