# Render backend keepalive

Implemented on 2026-10-08 for `https://portfolio-tracker-p6ha.onrender.com`.
This is infrastructure work; Trackr remains at frontend version 1.0.43.

## Configuration

- Public `GET /health`: HTTP 200, `{"status":"ok"}`, `Cache-Control: no-store`.
- Async endpoint in the portfolio-tracker backend, without authentication,
  Supabase queries, market-price requests or portfolio calculations. This is
  process liveness after startup, not a dependency/readiness check.
- Shared Supabase project: `nitbisweytddtigoebeh`.
- Extensions: `pg_cron` and `pg_net`.
- Job: `trackr-render-keepalive`, schedule `*/10 * * * *` (UTC), active.
- HTTP timeout: 180,000 ms. Requests start after the enqueue transaction commits.
- No bearer token, service key, user data or credentials in the command.
- Shared migration: `20261008120000_render_backend_keepalive.sql`, mirrored in
  Trackr and FitTrackr. Named scheduling updates the same named job if repeated.

The cron runs on Supabase independently of the PWA and the user's computer.
It reduces Render's 15-minute idle spin-downs. Render can still restart or exhaust
the shared Free allowance, and SQLite price caches remain ephemeral. A paused
Supabase project cannot run its cron. Keepalive does not accelerate portfolio
calculations or warm all market-data caches.

## Verification

The backend test exercises the unauthenticated route without Supabase credentials
and forbids outbound connections. It checks the HTTP response and no-store header.
The linked migration dry-run must show only the keepalive migration before push.
After deployment, check the public endpoint, the enabled cron, and actual HTTP
responses. A successful cron run only confirms that PostgreSQL queued the request.

Production verification on 2026-10-08:

- Backend [commit 9ebadf3](https://github.com/Luca404/portfolio-tracker/commit/9ebadf3)
  was published on main and the new route became available on Render.
- Direct `/health`: HTTP 200 with the expected body/no-store header, about 0.157s.
- Supabase manual request ID 1: HTTP 200, expected body, no timeout/error.
- For a single smoke run, the named job was temporarily set to every minute.
  The automatic run at 18:42 UTC succeeded; pg_net response ID 2 was HTTP 200
  with the expected body and no timeout/error. It was then restored to
  `*/10 * * * *`. Final verification found exactly one active named job with
  that schedule and the 180,000ms HTTP timeout.
- `pg_cron` 1.6.4 and `pg_net` 0.20.0 are installed; the shared migration is
  recorded. Both applications' linked dry-runs report up to date.
- The endpoint test passed. No authenticated portfolio requests were made;
  these checks establish liveness and scheduler operation, not recap/detail
  performance. Long-term uptime and a future cold restart have not been tested.

## Inspect

Run these as an administrator through the linked Supabase CLI or SQL Editor;
they read infrastructure metadata, not application rows.

```sql
select jobid, jobname, schedule, active, command
from cron.job where jobname = 'trackr-render-keepalive';

select start_time, end_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job
               where jobname = 'trackr-render-keepalive')
order by start_time desc limit 10;

-- pg_net responses include other jobs too; retained for about six hours by default.
select id, status_code, timed_out, error_msg, content, created
from net._http_response order by created desc limit 10;
```

To verify a specific ping unambiguously, enqueue it separately and note the ID:

```sql
select net.http_get(
  url := 'https://portfolio-tracker-p6ha.onrender.com/health',
  headers := '{"User-Agent":"trackr-render-keepalive","Accept":"application/json"}'::jsonb,
  timeout_milliseconds := 180000
) as request_id;
```

After that transaction commits, inspect `net._http_response` with
`where id = <request_id>`. Expect 200, `timed_out = false`, no error, and
`{"status":"ok"}`. Investigate timeouts/non-200 responses even if cron says
`succeeded`; the next scheduled call retries naturally, without extra jobs.

## Pause, resume or remove

```sql
-- Pause (retains the job and its configuration).
select cron.alter_job(jobid, active := false)
from cron.job where jobname = 'trackr-render-keepalive';

-- Resume.
select cron.alter_job(jobid, active := true)
from cron.job where jobname = 'trackr-render-keepalive';

-- Remove this job only; keep shared extensions and other scheduled tasks.
select cron.unschedule(jobid)
from cron.job where jobname = 'trackr-render-keepalive';
```

After removal, restore with the named `cron.schedule(...)` statement from the
migration. Do not rewrite the already-applied migration or reset the database.
Record persistent configuration changes in a new shared migration.

## Remaining performance work

The frontend already loads recap before sequential details. Compare startup,
recap and detail timings separately using normal authenticated app requests;
this keepalive verification does not calculate or inspect user portfolios.
Persisting market prices and serving cached recaps remain roadmap item 4.

References: [Supabase HTTP requests](https://supabase.com/docs/guides/database/extensions/pg_net),
[Cron administration](https://supabase.com/docs/guides/cron/quickstart),
[Render Free behavior](https://render.com/docs/free).
