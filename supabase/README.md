# Shared Supabase migrations

Trackr and `../fitness-tracker/` link to the same hosted project, `nitbisweytddtigoebeh`. The local frontend currently uses `http://127.0.0.1:54321`; it is a separate database, not the hosted project.

The historical migration files were fetched from the hosted migration ledger, including FitTrackr migrations. Do not rewrite or reapply them. There is no central `../supabase/` checkout on this machine. Use globally unique migration versions and keep both application ledgers synchronized after applying a shared migration. Inspect `supabase migration list --linked` and `supabase db push --linked --dry-run` before an actual push. Never run `supabase db reset --linked`.

The seven new migrations `20261004165900` through `20261004170500` implement main schema reconciliation, finance security, the FitTrackr meal-item correction, atomic money operations, import validation and constraint validation. They do not implement multicurrency. The FitTrackr policy change is deliberately confined to the relationship between an entry and its meal.

All seven were applied locally and to the hosted project on 2026-10-04. FitTrackr has the full meal-item migration and already-applied finance ledger markers pointing to this repository. Both projects' linked dry-runs report up to date. `python3 scripts/verify-db-security.py` reads aggregate counts only using the CLI connection and an explicit read-only transaction; the saved hosted result has zero anomalies in the checks listed in its SQL. It does not inspect individual user records or modify data.

For the older local Trackr installation, `python3 scripts/apply-local-security.py` saves a private full database backup in `/tmp` and applies just these seven reviewed migrations plus ledger entries in one transaction. It refuses to replay them. It does not apply unrelated historical fitness upgrades or reset either application's data.

Run `scripts/test-db-security.sh bootstrap` and `scripts/test-db-concurrency.sh` against the local container. These scripts exclusively recreate/use the separate `trackr_security_tests` database with synthetic users. The snapshot in `docs/security-audit-2026-10-04/schema-remoto-public.sql` contains schema only, not user data. The tests verify owner/editor/viewer isolation, cross-profile references, invitation lifecycle and rate limits, recurrence concurrency, rollback and the financial export round-trip.

New RPCs must explicitly grant `EXECUTE` to the intended authenticated/service roles. Default function execution for PUBLIC, anon and authenticated is revoked for future functions owned by postgres. New anonymous table/sequence access must be explicitly granted. Existing authenticated fitness CRUD/RPC grants are preserved; unnecessary TRUNCATE/REFERENCES/TRIGGER grants are removed. All new public tables must enable RLS with ownership policies; CI checks this invariant.

New constraints protect future writes immediately. The last migration validates existing rows only when they already comply; historical anomalies are reported as counts and retained for review. The main reconciliation repairs null profile IDs only where the original creator and parent identify the same owner unambiguously.

The export is version 2 and covers the active financial profile, all eight financial entity sets and their original IDs/relationships. It excludes Auth credentials, invitation lifecycle, fitness data and market caches. An admin round-trip is tested in an isolated database; there is no JSON-restore UI. Use a full database backup for infrastructure recovery.
