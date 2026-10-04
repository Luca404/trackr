#!/usr/bin/env bash
set -euo pipefail
# Never accepts a remote host or another DB. Fixtures contain synthetic data only.
container=supabase_db_trackr
database=trackr_security_tests
if [ "${1:-}" = bootstrap ]; then
 docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'DROP DATABASE IF EXISTS trackr_security_tests;'
 docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'CREATE DATABASE trackr_security_tests;'
 docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" < tests/db-bootstrap.sql
 docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" < "${2:-docs/security-audit-2026-10-04/schema-remoto-public.sql}"
 docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" < tests/db-legacy-seed.sql
fi
for migration in supabase/migrations/20261004165900*.sql supabase/migrations/2026100417*.sql; do
 docker exec -i "$container" psql -X -1 -f - -v ON_ERROR_STOP=1 -U postgres -d "$database" < "$migration"
done
if [ -f tests/db-security.sql ]; then
 docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" < tests/db-security.sql
fi

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" < tests/db-legacy-check.sql
