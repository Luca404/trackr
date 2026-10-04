alter table public.user_goals
  add column if not exists calculation_weight_kg float;
update public.user_goals as goals
set calculation_weight_kg = coalesce(
  (
    select logs.weight_kg
    from public.weight_logs as logs
    where logs.user_id = goals.user_id
      and logs.date <= goals.updated_at::date
    order by logs.date desc
    limit 1
  ),
  profiles.weight_kg
)
from public.user_health_profiles as profiles
where goals.user_id = profiles.user_id
  and goals.calculation_weight_kg is null;
alter table public.user_goals
  add constraint user_goals_calculation_weight_check
    check (calculation_weight_kg is null or calculation_weight_kg between 20 and 400);
create or replace function public.complete_health_onboarding(p_profile jsonb, p_goals jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := (p_profile->>'user_id')::uuid;
begin
  if auth.uid() is null or auth.uid() <> v_user_id or (p_goals->>'user_id')::uuid <> v_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.user_health_profiles (
    user_id, age, sex, height_cm, weight_kg, activity_level, does_resistance_training,
    objective, target_weight_kg, target_date, body_fat_pct, bmr_override, updated_at
  ) values (
    v_user_id, (p_profile->>'age')::int, p_profile->>'sex',
    (p_profile->>'height_cm')::float, (p_profile->>'weight_kg')::float,
    p_profile->>'activity_level', coalesce((p_profile->>'does_resistance_training')::boolean, false),
    p_profile->>'objective', nullif(p_profile->>'target_weight_kg', '')::float,
    nullif(p_profile->>'target_date', '')::date,
    nullif(p_profile->>'body_fat_pct', '')::float,
    nullif(p_profile->>'bmr_override', '')::float, now()
  )
  on conflict (user_id) do update set
    age = excluded.age,
    sex = excluded.sex,
    height_cm = excluded.height_cm,
    weight_kg = excluded.weight_kg,
    activity_level = excluded.activity_level,
    does_resistance_training = excluded.does_resistance_training,
    objective = excluded.objective,
    target_weight_kg = excluded.target_weight_kg,
    target_date = excluded.target_date,
    body_fat_pct = excluded.body_fat_pct,
    bmr_override = excluded.bmr_override,
    updated_at = now();

  insert into public.user_goals (
    user_id, calorie_target, protein_g, carbs_g, fat_g, calculation_weight_kg, updated_at
  ) values (
    v_user_id, (p_goals->>'calorie_target')::int, (p_goals->>'protein_g')::float,
    (p_goals->>'carbs_g')::float, (p_goals->>'fat_g')::float,
    coalesce((p_goals->>'calculation_weight_kg')::float, (p_profile->>'weight_kg')::float), now()
  )
  on conflict (user_id) do update set
    calorie_target = excluded.calorie_target,
    protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g,
    calculation_weight_kg = excluded.calculation_weight_kg,
    updated_at = now();
end;
$$;
