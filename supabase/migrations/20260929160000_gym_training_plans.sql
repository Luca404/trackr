-- Gym plans are reusable templates. Sessions and their sets keep a snapshot of
-- the performed exercises so editing or deleting a plan never rewrites history.
create table public.gym_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gym_plans_user_idx on public.gym_plans (user_id, created_at);
alter table public.gym_plans enable row level security;
create policy "own gym_plans" on public.gym_plans
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create table public.gym_plan_exercises (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.gym_plans on delete cascade,
  position integer not null check (position >= 0),
  exercise_key text,
  exercise_name text not null check (length(trim(exercise_name)) > 0),
  equipment text not null check (length(trim(equipment)) > 0),
  target_sets integer not null check (target_sets between 1 and 20),
  target_reps integer not null check (target_reps between 1 and 100),
  unique (plan_id, position)
);
alter table public.gym_plan_exercises enable row level security;
create policy "own gym_plan_exercises" on public.gym_plan_exercises
  using (exists (select 1 from public.gym_plans p where p.id = plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.gym_plans p where p.id = plan_id and p.user_id = auth.uid()));
create table public.gym_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  plan_id uuid references public.gym_plans on delete set null,
  plan_name text not null,
  date date not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index gym_sessions_user_date_idx on public.gym_sessions (user_id, date desc);
create unique index gym_sessions_one_active_idx on public.gym_sessions (user_id)
  where completed_at is null;
alter table public.gym_sessions enable row level security;
create policy "own gym_sessions" on public.gym_sessions
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create table public.gym_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.gym_sessions on delete cascade,
  exercise_position integer not null check (exercise_position >= 0),
  exercise_key text,
  exercise_name text not null check (length(trim(exercise_name)) > 0),
  equipment text not null check (length(trim(equipment)) > 0),
  set_number integer not null check (set_number > 0),
  target_reps integer not null check (target_reps between 1 and 100),
  weight_kg numeric(8, 2) check (weight_kg >= 0),
  reps integer check (reps > 0),
  done boolean not null default false,
  check (not done or reps is not null),
  unique (session_id, exercise_position, set_number)
);
create index gym_sets_session_idx on public.gym_sets (session_id, exercise_position, set_number);
alter table public.gym_sets enable row level security;
create policy "own gym_sets" on public.gym_sets
  using (exists (select 1 from public.gym_sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.gym_sessions s where s.id = session_id and s.user_id = auth.uid()));
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
    plan_id, position, exercise_key, exercise_name, equipment, target_sets, target_reps
  )
  select v_plan_id, (e.ordinal - 1)::integer, x.exercise_key,
    trim(x.exercise_name), trim(x.equipment), x.target_sets, x.target_reps
  from jsonb_array_elements(p_exercises) with ordinality as e(value, ordinal)
  cross join lateral jsonb_to_record(e.value) as x(
    exercise_key text, exercise_name text, equipment text,
    target_sets integer, target_reps integer
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
    set_number, target_reps, weight_kg, reps
  )
  select v_session_id, pe.position, pe.exercise_key, pe.exercise_name,
    pe.equipment, series.number, pe.target_reps, previous.weight_kg,
    coalesce(previous.reps, pe.target_reps)
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
revoke execute on function public.save_gym_plan(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.start_gym_session(uuid, uuid, date) from public, anon;
grant execute on function public.save_gym_plan(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.start_gym_session(uuid, uuid, date) to authenticated;
