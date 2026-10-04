-- Order is per account and survives navigation, reloads and other devices.
alter table public.gym_plans add column position integer;
with ordered as (
  select id, (row_number() over (partition by user_id order by created_at, id) - 1)::integer as position
  from public.gym_plans
)
update public.gym_plans p set position = ordered.position
from ordered where ordered.id = p.id;
create or replace function public.assign_gym_plan_position()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- Share the lock with reordering, so newly created plans append consistently.
  perform pg_advisory_xact_lock(hashtextextended('fittrackr-gym-order:' || new.user_id::text, 0));
  if new.position is null then
    select coalesce(max(position), -1) + 1 into new.position
    from public.gym_plans where user_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger assign_gym_plan_position_before_insert
before insert on public.gym_plans
for each row execute function public.assign_gym_plan_position();
alter table public.gym_plans
  alter column position set not null,
  add constraint gym_plans_position_nonnegative check (position >= 0),
  add constraint gym_plans_user_position_unique unique (user_id, position) deferrable initially immediate;
create or replace function public.reorder_gym_plans(p_plan_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then raise exception 'not authorized' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fittrackr-gym-order:' || v_user_id::text, 0));
  perform 1 from public.gym_plans where user_id = v_user_id order by id for update;
  select count(*) into v_count from public.gym_plans where user_id = v_user_id;
  if p_plan_ids is null or cardinality(p_plan_ids) <> v_count
    or array_position(p_plan_ids, null) is not null
    or (select count(distinct id) from unnest(p_plan_ids) as requested(id)) <> v_count
    or exists (
      select 1 from unnest(p_plan_ids) as requested(id)
      where not exists (select 1 from public.gym_plans p where p.id = requested.id and p.user_id = v_user_id)
    ) then
    raise exception 'invalid gym plan order; reload plans' using errcode = '22023';
  end if;
  -- A swap temporarily reuses a position; validate uniqueness at commit.
  set constraints gym_plans_user_position_unique deferred;
  update public.gym_plans p set position = (requested.ordinal - 1)::integer
  from unnest(p_plan_ids) with ordinality as requested(id, ordinal)
  where p.id = requested.id and p.user_id = v_user_id;
end;
$$;
revoke execute on function public.reorder_gym_plans(uuid[]) from public, anon;
grant execute on function public.reorder_gym_plans(uuid[]) to authenticated;
