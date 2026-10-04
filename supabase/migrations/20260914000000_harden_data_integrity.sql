-- Consolidate duplicate meal buckets created by the old per-item client flow.
with ranked as (
  select
    id,
    first_value(id) over (
      partition by user_id, date, meal_type
      order by created_at, id
    ) as keep_id,
    row_number() over (
      partition by user_id, date, meal_type
      order by created_at, id
    ) as position
  from public.meals
)
update public.meal_items as item
set meal_id = ranked.keep_id
from ranked
where item.meal_id = ranked.id and ranked.position > 1;
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, date, meal_type
      order by created_at, id
    ) as position
  from public.meals
)
delete from public.meals as meal
using ranked
where meal.id = ranked.id and ranked.position > 1;
create unique index if not exists meals_user_date_type_key
  on public.meals (user_id, date, meal_type);
drop index if exists public.meals_user_id_date_idx;
drop index if exists public.weight_logs_user_id_date_idx;
-- Enforce valid values for new writes without making the rollout fail if old
-- rows need manual cleanup. Constraints can be validated after that cleanup.
alter table public.user_health_profiles
  add constraint user_health_profiles_age_check_v2 check (age between 10 and 120) not valid,
  add constraint user_health_profiles_height_check_v2 check (height_cm between 100 and 250) not valid,
  add constraint user_health_profiles_weight_check_v2 check (weight_kg between 20 and 400) not valid,
  add constraint user_health_profiles_target_weight_check_v2 check (target_weight_kg between 20 and 400) not valid,
  add constraint user_health_profiles_body_fat_check_v2 check (body_fat_pct between 1 and 75) not valid,
  add constraint user_health_profiles_bmr_check_v2 check (bmr_override > 0) not valid;
alter table public.user_goals
  add constraint user_goals_calories_check_v2 check (calorie_target > 0) not valid,
  add constraint user_goals_protein_check_v2 check (protein_g >= 0) not valid,
  add constraint user_goals_carbs_check_v2 check (carbs_g >= 0) not valid,
  add constraint user_goals_fat_check_v2 check (fat_g >= 0) not valid;
alter table public.meal_items
  add constraint meal_items_quantity_check_v2 check (quantity_g > 0) not valid,
  add constraint meal_items_calories_check_v2 check (calories >= 0) not valid,
  add constraint meal_items_protein_check_v2 check (protein_g >= 0) not valid,
  add constraint meal_items_carbs_check_v2 check (carbs_g >= 0) not valid,
  add constraint meal_items_fat_check_v2 check (fat_g >= 0) not valid;
alter table public.workouts
  add constraint workouts_duration_check_v2 check (duration_min > 0) not valid,
  add constraint workouts_calories_check_v2 check (calories_burned >= 0) not valid;
alter table public.weight_logs
  add constraint weight_logs_weight_check_v2 check (weight_kg between 20 and 400) not valid;
alter table public.dishes
  add constraint dishes_name_check_v2 check (length(trim(name)) > 0) not valid;
alter table public.dish_items
  add constraint dish_items_quantity_check_v2 check (quantity_g > 0) not valid,
  add constraint dish_items_calories_check_v2 check (calories >= 0) not valid,
  add constraint dish_items_protein_check_v2 check (protein_g >= 0) not valid,
  add constraint dish_items_carbs_check_v2 check (carbs_g >= 0) not valid,
  add constraint dish_items_fat_check_v2 check (fat_g >= 0) not valid;
alter table public.pantry_items
  add constraint pantry_items_quantity_check_v2 check (quantity > 0) not valid,
  add constraint pantry_items_calories_check_v2 check (calories_100g >= 0) not valid,
  add constraint pantry_items_protein_check_v2 check (protein_100g >= 0) not valid,
  add constraint pantry_items_carbs_check_v2 check (carbs_100g >= 0) not valid,
  add constraint pantry_items_fat_check_v2 check (fat_100g >= 0) not valid;
drop policy if exists "own meal_items" on public.meal_items;
create policy "own meal_items" on public.meal_items
  using (exists (
    select 1 from public.meals m
    where m.id = meal_id and m.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.meals m
    where m.id = meal_id and m.user_id = auth.uid()
  ));
drop policy if exists "own dish_items" on public.dish_items;
create policy "own dish_items" on public.dish_items
  using (exists (
    select 1 from public.dishes d
    where d.id = dish_id and d.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.dishes d
    where d.id = dish_id and d.user_id = auth.uid()
  ));
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
    user_id, age, sex, height_cm, weight_kg, activity_level, objective,
    target_weight_kg, target_date, body_fat_pct, bmr_override, updated_at
  ) values (
    v_user_id, (p_profile->>'age')::int, p_profile->>'sex',
    (p_profile->>'height_cm')::float, (p_profile->>'weight_kg')::float,
    p_profile->>'activity_level', p_profile->>'objective',
    nullif(p_profile->>'target_weight_kg', '')::float,
    nullif(p_profile->>'target_date', '')::date,
    nullif(p_profile->>'body_fat_pct', '')::float,
    nullif(p_profile->>'bmr_override', '')::float, now()
  )
  on conflict (user_id) do update set
    age = excluded.age, sex = excluded.sex, height_cm = excluded.height_cm,
    weight_kg = excluded.weight_kg, activity_level = excluded.activity_level,
    objective = excluded.objective, target_weight_kg = excluded.target_weight_kg,
    target_date = excluded.target_date, body_fat_pct = excluded.body_fat_pct,
    bmr_override = excluded.bmr_override, updated_at = now();

  insert into public.user_goals (user_id, calorie_target, protein_g, carbs_g, fat_g, updated_at)
  values (
    v_user_id, (p_goals->>'calorie_target')::int, (p_goals->>'protein_g')::float,
    (p_goals->>'carbs_g')::float, (p_goals->>'fat_g')::float, now()
  )
  on conflict (user_id) do update set
    calorie_target = excluded.calorie_target, protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, updated_at = now();
end;
$$;
create or replace function public.add_meal_items(
  p_user_id uuid, p_date date, p_meal_type text, p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_meal public.meals%rowtype;
  v_items jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array' using errcode = '22023';
  end if;

  insert into public.meals (user_id, date, meal_type, name)
  values (p_user_id, p_date, p_meal_type, null)
  on conflict (user_id, date, meal_type) do update set name = public.meals.name
  returning * into v_meal;

  with inserted as (
    insert into public.meal_items (
      meal_id, food_name, quantity_g, calories, protein_g, carbs_g, fat_g, source, off_food_id
    )
    select v_meal.id, x.food_name, x.quantity_g, x.calories, x.protein_g,
      x.carbs_g, x.fat_g, coalesce(x.source, 'manual'), x.off_food_id
    from jsonb_to_recordset(p_items) as x(
      food_name text, quantity_g float, calories float, protein_g float,
      carbs_g float, fat_g float, source text, off_food_id text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) into v_items from inserted;
  return jsonb_build_object('meal', to_jsonb(v_meal), 'items', v_items);
end;
$$;
create or replace function public.create_dish_with_items(p_user_id uuid, p_name text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dish public.dishes%rowtype;
  v_items jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array' using errcode = '22023';
  end if;

  insert into public.dishes (user_id, name) values (p_user_id, trim(p_name)) returning * into v_dish;
  with inserted as (
    insert into public.dish_items (
      dish_id, food_name, quantity_g, calories, protein_g, carbs_g, fat_g, source, off_food_id
    )
    select v_dish.id, x.food_name, x.quantity_g, x.calories, x.protein_g,
      x.carbs_g, x.fat_g, coalesce(x.source, 'manual'), x.off_food_id
    from jsonb_to_recordset(p_items) as x(
      food_name text, quantity_g float, calories float, protein_g float,
      carbs_g float, fat_g float, source text, off_food_id text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) into v_items from inserted;
  return to_jsonb(v_dish) || jsonb_build_object('items', v_items);
end;
$$;
create or replace function public.update_dish_with_items(p_dish_id uuid, p_name text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dish public.dishes%rowtype;
  v_items jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array' using errcode = '22023';
  end if;
  update public.dishes set name = trim(p_name), updated_at = now()
  where id = p_dish_id and user_id = auth.uid()
  returning * into v_dish;
  if not found then
    raise exception 'dish not found' using errcode = 'P0002';
  end if;

  delete from public.dish_items where dish_id = p_dish_id;
  with inserted as (
    insert into public.dish_items (
      dish_id, food_name, quantity_g, calories, protein_g, carbs_g, fat_g, source, off_food_id
    )
    select p_dish_id, x.food_name, x.quantity_g, x.calories, x.protein_g,
      x.carbs_g, x.fat_g, coalesce(x.source, 'manual'), x.off_food_id
    from jsonb_to_recordset(p_items) as x(
      food_name text, quantity_g float, calories float, protein_g float,
      carbs_g float, fat_g float, source text, off_food_id text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) into v_items from inserted;
  return to_jsonb(v_dish) || jsonb_build_object('items', v_items);
end;
$$;
revoke execute on function public.complete_health_onboarding(jsonb, jsonb) from public, anon;
revoke execute on function public.add_meal_items(uuid, date, text, jsonb) from public, anon;
revoke execute on function public.create_dish_with_items(uuid, text, jsonb) from public, anon;
revoke execute on function public.update_dish_with_items(uuid, text, jsonb) from public, anon;
grant execute on function public.complete_health_onboarding(jsonb, jsonb) to authenticated;
grant execute on function public.add_meal_items(uuid, date, text, jsonb) to authenticated;
grant execute on function public.create_dish_with_items(uuid, text, jsonb) to authenticated;
grant execute on function public.update_dish_with_items(uuid, text, jsonb) to authenticated;
