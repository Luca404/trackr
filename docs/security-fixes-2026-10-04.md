# Correzioni del 4 ottobre 2026

La copia locale è stata portata su `main`, commit `e194dbb`, uguale a `origin/main`. Il branch `dev` è rimasto separato; la multicurrency è esclusa da queste modifiche.

Le sette migrazioni sono state applicate sia al database locale configurato nell'app sia al Supabase remoto condiviso `nitbisweytddtigoebeh`. Un backup privato del database locale precedente alle modifiche è conservato in `/tmp/trackr-local-before-security-20261004T203754Z.dump` (permessi 0600; contiene dati, non va committato). Lo storico di FitTrackr è stato sincronizzato: la sua correzione SQL è presente per intero, le sei versioni finanziarie sono marker delle migrazioni già applicate da Trackr. I dry-run di entrambi i progetti restituiscono `Remote database is up to date`.

| Finding | Correzione |
| --- | --- |
| S1–S3 | Lettura per i membri; INSERT/UPDATE/DELETE solo owner/editor. Identità e profilo immutabili; riferimenti account/portfolio/ricorrenza/transazione vincolati al medesimo profilo. Il profilo principale e la sua membership owner sono protetti. |
| S4–S6 | RPC dedicate per revoca/rifiuto; accettazione con lock. Gli inviti a email esistenti e inesistenti producono lo stesso record; limite serializzato di dieci/ora. Vietate le scritture dirette; helper vincolati all'identità del chiamante e non anonimi. |
| S7 | search_path fissato, schema privato specifico Trackr, grant ridotti e default EXECUTE revocato per nuove RPC. I grant necessari alle funzioni fitness esistenti sono mantenuti. |
| S8 | Correlazione entry/pasto qualificata e foreign key composta per FitTrackr. Nessuna cancellazione dei dati fitness. |
| S9, I4 | Supabase gestisce la sessione senza copie dei token; cache per utente/profilo, pulizia al logout e invalidazione delle risposte obsolete. I viewer non creano default né processano ricorrenze; quote gratuite e operazioni filtrate per profilo. |
| I1–I2 | Salvataggio movimento/ordine/ricorrenza e cancellazioni composte in RPC atomiche. Lock per profilo e per ricorrenza, identità dell'occorrenza e retry senza duplicati. Date di fine mese corrette. |
| I3 | Export finanziario v2 completo delle otto entità del profilo e relazioni; round-trip amministrativo verificato nel database isolato. Non include Auth/fitness e non introduce una UI di restore. |
| I5 | Limiti 20 MB/100000 record, chiusura delle risorse SQLite anche in errore, rifiuto dei payload vuoti/malformati prima dell'import. Vincoli server su finitezza, segni e valori di quantità/prezzo/commissioni. |
| Dipendenze, I6 | Lockfile aggiornato, Tailwind 4 senza la catena braces vulnerabile, serialize-javascript corretto, suite frontend/database e CI. Lint senza errori o warning. |

Il lint mantiene le regole dei React Hooks per React 18, senza attivare le diagnostiche opzionali del React Compiler. Restano tipi dinamici in alcune strutture legacy dell'import Kakebo, con eccezione ESLint limitata a quel file; il confine di scrittura è validato nel database. La CI usa le versioni correnti delle azioni [checkout](https://github.com/actions/checkout) e [setup-node](https://github.com/actions/setup-node).

Sono aggiunti header CSP, anti-framing, nosniff e Referrer-Policy a Vercel. Il backend portfolio autorizzato è quello Railway già usato dall'app; un diverso `VITE_PF_BACKEND_URL` di produzione richiede aggiornare la allowlist `connect-src`. Lo script iniziale del tema è esterno e gli stili rispettano i layer di Tailwind 4.

Verifiche completate:

- Node 22.23.2, installazione dal lockfile, lint con zero warning, TypeScript e build di produzione riusciti. Il progetto richiede Node >=22.13 (`.nvmrc`: 22).
- Otto test frontend passati: isolamento delle cache, logout/cambio profilo durante richieste, risposte di mutazioni obsolete, viewer e date delle ricorrenze.
- Quarantotto verifiche SQL passate nel database isolato sullo schema remoto e quarantasette sullo schema locale precedente, che usa una versione più vecchia della RPC fitness; due ulteriori prove di concorrenza passate.
- Otto verifiche con SDK e Auth Supabase reali nel database locale, con utente di test rimosso alla fine; smoke test Chromium su login, tema scuro e schermate autenticate desktop/mobile, senza errori JavaScript/CSP o copie aggiuntive dei token.
- `npm audit` completo: [zero vulnerabilità note](security-audit-2026-10-04/npm-audit-fixed.json), incluse le dipendenze di sviluppo.
- [Verifica remota in sola lettura](security-audit-2026-10-04/remote-integrity-fixed.json): zero anomalie nei conteggi di RLS, riferimenti tra profili, membership owner, collegamenti pasto/entry, duplicati di ricorrenze e vincoli delle nuove migrazioni; nessun accesso anonimo alle RPC finanziarie/schema privato. [Snapshot SQL aggiornato](security-audit-2026-10-04/schema-remoto-fixed.sql), solo schema.

Resta il warning di dimensione del bundle principale (~770 KB prima della compressione), da affrontare come ottimizzazione. Le vecchie CHECK fitness già `NOT VALID` nello schema remoto non sono incluse nel conteggio dei sette nuovi vincoli verificati. La CI è aggiunta e i controlli equivalenti sono passati localmente; non è stata ancora eseguita su GitHub.

Le migrazioni e la gestione del database condiviso sono descritte in [supabase/README.md](../supabase/README.md). La release frontend è `1.0.41`; il push su `main` attiva il deploy Vercel. I risultati sopra sono le verifiche prepubblicazione. Il backend portfolio esterno e le impostazioni Auth di produzione restano fuori dalle verifiche di questo intervento.
