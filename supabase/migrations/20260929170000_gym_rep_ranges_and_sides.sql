-- Preserve existing fixed goals while allowing ranges, per-side work and sets
-- with no prescribed repetition count.
alter table public.gym_plan_exercises
  alter column target_reps drop not null,
  add column target_reps_max integer check (target_reps_max between 1 and 100),
  add column per_side boolean not null default false,
  add constraint gym_plan_reps_range check (
    target_reps_max is null or (target_reps is not null and target_reps_max >= target_reps)
  );
alter table public.gym_sets
  alter column target_reps drop not null,
  add column target_reps_max integer check (target_reps_max between 1 and 100),
  add column per_side boolean not null default false,
  add constraint gym_set_reps_range check (
    target_reps_max is null or (target_reps is not null and target_reps_max >= target_reps)
  );
create or replace function public.save_gym_plan(
  p_user_id uuid, p_plan_id uuid, p_name text, p_exercises jsonb
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_plan_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0
    or coalesce(jsonb_typeof(p_exercises), 'null') <> 'array' then
    raise exception 'invalid gym plan' using errcode = '22023';
  end if;
  if jsonb_array_length(p_exercises) = 0 then
    raise exception 'empty gym plan' using errcode = '22023';
  end if;
  if p_plan_id is null then
    insert into public.gym_plans (user_id, name) values (p_user_id, trim(p_name))
    returning id into v_plan_id;
  else
    update public.gym_plans set name = trim(p_name), updated_at = now()
    where id = p_plan_id and user_id = p_user_id returning id into v_plan_id;
    if not found then raise exception 'gym plan not found' using errcode = 'P0002'; end if;
    delete from public.gym_plan_exercises where plan_id = v_plan_id;
  end if;

  insert into public.gym_plan_exercises (
    plan_id, position, exercise_key, exercise_name, equipment,
    target_sets, target_reps, target_reps_max, per_side
  )
  select v_plan_id, (e.ordinal - 1)::integer, x.exercise_key,
    trim(x.exercise_name), trim(x.equipment), x.target_sets,
    x.target_reps, x.target_reps_max, coalesce(x.per_side, false)
  from jsonb_array_elements(p_exercises) with ordinality as e(value, ordinal)
  cross join lateral jsonb_to_record(e.value) as x(
    exercise_key text, exercise_name text, equipment text,
    target_sets integer, target_reps integer, target_reps_max integer, per_side boolean
  );
  return v_plan_id;
end;
$$;
create or replace function public.start_gym_session(
  p_user_id uuid, p_plan_id uuid, p_date date
)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_plan public.gym_plans%rowtype;
  v_session_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_plan from public.gym_plans
  where id = p_plan_id and user_id = p_user_id;
  if not found then raise exception 'gym plan not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.gym_plan_exercises where plan_id = p_plan_id) then
    raise exception 'gym plan is empty' using errcode = '22023';
  end if;

  insert into public.gym_sessions (user_id, plan_id, plan_name, date)
  values (p_user_id, p_plan_id, v_plan.name, p_date) returning id into v_session_id;

  insert into public.gym_sets (
    session_id, exercise_position, exercise_key, exercise_name, equipment,
    set_number, target_reps, target_reps_max, per_side, weight_kg, reps
  )
  select v_session_id, pe.position, pe.exercise_key, pe.exercise_name,
    pe.equipment, series.number, pe.target_reps, pe.target_reps_max,
    pe.per_side, previous.weight_kg, coalesce(previous.reps, pe.target_reps)
  from public.gym_plan_exercises pe
  cross join lateral generate_series(1, pe.target_sets) as series(number)
  left join lateral (
    select gs.weight_kg, gs.reps
    from public.gym_sets gs
    join public.gym_sessions s on s.id = gs.session_id
    where s.user_id = p_user_id and s.completed_at is not null and gs.done
      and ((pe.exercise_key is not null and gs.exercise_key = pe.exercise_key)
        or (pe.exercise_key is null and lower(gs.exercise_name) = lower(pe.exercise_name)))
    order by s.completed_at desc, gs.set_number desc
    limit 1
  ) previous on true
  where pe.plan_id = p_plan_id;
  return v_session_id;
end;
$$;
