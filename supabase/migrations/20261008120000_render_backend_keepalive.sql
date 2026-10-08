-- Shared infrastructure only: no application rows or user credentials.
-- Named scheduling replaces this same job rather than creating duplicates.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
    'trackr-render-keepalive',
    '*/10 * * * *',
    $command$
    SELECT net.http_get(
        url := 'https://portfolio-tracker-p6ha.onrender.com/health',
        headers := '{"User-Agent":"trackr-render-keepalive","Accept":"application/json"}'::jsonb,
        timeout_milliseconds := 180000
    );
    $command$
);
