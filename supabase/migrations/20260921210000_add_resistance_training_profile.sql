alter table public.user_health_profiles
  add column if not exists does_resistance_training boolean not null default false;
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

  insert into public.user_goals (user_id, calorie_target, protein_g, carbs_g, fat_g, updated_at)
  values (
    v_user_id, (p_goals->>'calorie_target')::int, (p_goals->>'protein_g')::float,
    (p_goals->>'carbs_g')::float, (p_goals->>'fat_g')::float, now()
  )
  on conflict (user_id) do update set
    calorie_target = excluded.calorie_target,
    protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g,
    updated_at = now();
end;
$$;
