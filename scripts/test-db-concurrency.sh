#!/usr/bin/env bash
set -euo pipefail
# Uses only the isolated test DB; setup/cleanup never touches the application DB.
container=supabase_db_trackr
database=trackr_security_tests
log_dir=$(mktemp -d /tmp/trackr-concurrency.XXXXXX)
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" <<'SQL'
DELETE FROM public.profile_share_invitations WHERE invited_by='00000000-0000-0000-0000-000000000005';
DELETE FROM public.transactions WHERE profile_id='00000000-0000-0000-0000-000000000005';
DELETE FROM auth.users WHERE id='00000000-0000-0000-0000-000000000005';
INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000000005','concurrency@example.test');
INSERT INTO public.profiles(id,user_id,name) VALUES('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005','Concurrency');
INSERT INTO public.accounts(id,user_id,profile_id,name) VALUES(9001,'00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005','Concurrency');
INSERT INTO public.recurring_transactions(user_id,profile_id,account_id,type,category,amount,frequency,start_date,next_due_date) VALUES('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005',9001,'expense','Concurrency',1,'monthly','2026-08-31','2026-09-30');
SQL
process_sql="BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true); SELECT count(*) FROM public.process_recurring_transactions('00000000-0000-0000-0000-000000000005','2026-10-04'); SELECT pg_sleep(0.15); COMMIT;"
pids=()
for i in 1 2 3; do
 docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" -c "$process_sql" > "$log_dir/recurring-$i.log" 2>&1 &
 pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
pids=()
for i in {1..11}; do
 sql="BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true); SELECT public.create_profile_invitation('00000000-0000-0000-0000-000000000005','concurrent-$i@example.test','viewer'); COMMIT;"
 docker exec "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" -c "$sql" > "$log_dir/invite-$i.log" 2>&1 &
 pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid" || true; done
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database" <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM public.transactions WHERE profile_id='00000000-0000-0000-0000-000000000005')<>1 THEN RAISE EXCEPTION 'Concurrent recurring duplicates'; END IF;
 IF (SELECT count(*) FROM public.profile_share_invitations WHERE invited_by='00000000-0000-0000-0000-000000000005')<>10 THEN RAISE EXCEPTION 'Concurrent rate limit failed'; END IF;
 RAISE NOTICE 'PASS: three concurrent recurring requests create one occurrence';
 RAISE NOTICE 'PASS: eleven concurrent invitations create at most ten records';
END $$;
DELETE FROM public.orders WHERE portfolio_id IN(SELECT id FROM public.portfolios WHERE profile_id='00000000-0000-0000-0000-000000000005');
DELETE FROM public.transactions WHERE profile_id='00000000-0000-0000-0000-000000000005';
DELETE FROM public.profile_share_invitations WHERE invited_by='00000000-0000-0000-0000-000000000005';
DELETE FROM auth.users WHERE id='00000000-0000-0000-0000-000000000005';
SQL
printf 'Concurrency logs: %s\n' "$log_dir"
