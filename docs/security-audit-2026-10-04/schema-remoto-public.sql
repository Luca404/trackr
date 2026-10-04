


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."accept_profile_invitation"("p_invitation_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_inv   public.profile_share_invitations%ROWTYPE;
  v_email text;
BEGIN
  SELECT * INTO v_inv
  FROM public.profile_share_invitations
  WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;

  IF v_inv.status != 'pending' OR v_inv.expires_at < now() THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;

  -- Verifica che il chiamante sia il destinatario
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS DISTINCT FROM v_inv.invited_email THEN
    RAISE EXCEPTION 'not_recipient';
  END IF;

  -- Crea membership
  INSERT INTO public.profile_members (profile_id, user_id, role, email)
  VALUES (v_inv.profile_id, auth.uid(), v_inv.role, v_email)
  ON CONFLICT (profile_id, user_id) DO NOTHING;

  -- Aggiorna status
  UPDATE public.profile_share_invitations
  SET status = 'accepted'
  WHERE id = p_invitation_id;
END;
$$;


ALTER FUNCTION "public"."accept_profile_invitation"("p_invitation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_meal_entry"("p_user_id" "uuid", "p_date" "date", "p_meal_type" "text", "p_name" "text", "p_items" "jsonb", "p_dish_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_meal public.meals%rowtype;
  v_entry public.meal_entries%rowtype;
  v_items jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array' using errcode = '22023';
  end if;
  if p_dish_id is not null and not exists (
    select 1 from public.dishes d where d.id = p_dish_id and d.user_id = p_user_id
  ) then
    raise exception 'dish not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(dish_item_id uuid)
    where x.dish_item_id is not null and not exists (
      select 1 from public.dish_items di
      where di.id = x.dish_item_id and di.dish_id = p_dish_id
    )
  ) then
    raise exception 'dish ingredient not found' using errcode = 'P0002';
  end if;

  insert into public.meals (user_id, date, meal_type, name)
  values (p_user_id, p_date, p_meal_type, null)
  on conflict (user_id, date, meal_type) do update set name = public.meals.name
  returning * into v_meal;
  insert into public.meal_entries (meal_id, name, dish_id)
  values (v_meal.id, trim(p_name), p_dish_id)
  returning * into v_entry;

  insert into public.meal_items (
    meal_id, entry_id, position, dish_item_id, is_customization, food_name, quantity_g,
    piece_count, piece_size, unit, category, food_key, pantry_item_id,
    calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, alcohol_abv, source, off_food_id
  )
  select v_meal.id, v_entry.id, (element.ordinal - 1)::integer, x.dish_item_id,
    coalesce(x.is_customization, p_dish_id is not null and x.dish_item_id is null),
    x.food_name, x.quantity_g, x.piece_count, x.piece_size, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id,
    x.calories, x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g,
    x.salt_g, x.alcohol_abv, coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_array_elements(p_items) with ordinality as element(value, ordinal)
  cross join lateral jsonb_to_record(element.value) as x(
    dish_item_id uuid, is_customization boolean, food_name text, quantity_g float,
    piece_count float, piece_size text, unit text, category text, food_key text,
    pantry_item_id uuid, calories float, protein_g float, carbs_g float,
    fat_g float, fiber_g float, sugars_g float, salt_g float, alcohol_abv numeric, source text, off_food_id text
  );

  select coalesce(jsonb_agg(to_jsonb(mi) order by mi.position), '[]'::jsonb)
  into v_items from public.meal_items mi where mi.entry_id = v_entry.id;
  return jsonb_build_object('meal', to_jsonb(v_meal),
    'entry', to_jsonb(v_entry) || jsonb_build_object('items', v_items));
end;
$$;


ALTER FUNCTION "public"."add_meal_entry"("p_user_id" "uuid", "p_date" "date", "p_meal_type" "text", "p_name" "text", "p_items" "jsonb", "p_dish_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_prepared_batch_remaining"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    if old.prepared_batch_id is not null then
      update public.prepared_batches
      set remaining_g = least(total_cooked_g, remaining_g + old.cooked_portion_g)
      where id = old.prepared_batch_id;
    end if;
    return old;
  end if;

  select user_id into v_user_id from public.meals where id = new.meal_id;
  if new.prepared_batch_id is not null and not exists (
    select 1 from public.prepared_batches
    where id = new.prepared_batch_id and user_id = v_user_id
      and snapshot_dish_id = new.dish_id
  ) then
    raise exception 'prepared dish not found' using errcode = 'P0002';
  end if;

  if tg_op = 'UPDATE' and old.prepared_batch_id is not null then
    update public.prepared_batches
    set remaining_g = least(total_cooked_g, remaining_g + old.cooked_portion_g)
    where id = old.prepared_batch_id;
  end if;
  if new.prepared_batch_id is not null then
    update public.prepared_batches
    set remaining_g = remaining_g - new.cooked_portion_g
    where id = new.prepared_batch_id and remaining_g >= new.cooked_portion_g;
    if not found then
      raise exception 'not enough prepared dish remains' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."adjust_prepared_batch_remaining"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."alcohol_adjusted_calories"("p_calories" numeric, "p_volume" numeric, "p_source_abv" numeric, "p_abv" numeric, "p_unit" "text") RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select case when p_unit = 'ml' and p_source_abv is not null and p_abv is not null
    then round(greatest(0, p_calories - p_volume * p_source_abv / 100 * 0.789 * 7)
      + p_volume * p_abv / 100 * 0.789 * 7, 2)
    else round(p_calories) end;
$$;


ALTER FUNCTION "public"."alcohol_adjusted_calories"("p_calories" numeric, "p_volume" numeric, "p_source_abv" numeric, "p_abv" numeric, "p_unit" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_pantry_nutrition_to_dish_item"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_pantry public.pantry_items%rowtype;
begin
  if new.pantry_item_id is null then return new; end if;
  select * into v_pantry from public.pantry_items where id = new.pantry_item_id;
  if not found then return new; end if;

  new.alcohol_abv := coalesce(new.alcohol_abv, v_pantry.alcohol_abv);
  new.calories := public.alcohol_adjusted_calories((v_pantry.calories_100g * new.quantity_g / 100)::numeric, new.quantity_g::numeric, v_pantry.alcohol_abv, new.alcohol_abv, new.unit);
  new.protein_g := round((v_pantry.protein_100g * new.quantity_g / 100)::numeric, 1);
  new.carbs_g := round((v_pantry.carbs_100g * new.quantity_g / 100)::numeric, 1);
  new.fat_g := round((v_pantry.fat_100g * new.quantity_g / 100)::numeric, 1);
  if v_pantry.fiber_100g is not null then
    new.fiber_g := round((v_pantry.fiber_100g * new.quantity_g / 100)::numeric, 2);
  end if;
  if v_pantry.sugars_100g is not null then
    new.sugars_g := round((v_pantry.sugars_100g * new.quantity_g / 100)::numeric, 2);
  end if;
  if v_pantry.salt_100g is not null then
    new.salt_g := round((v_pantry.salt_100g * new.quantity_g / 100)::numeric, 2);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."apply_pantry_nutrition_to_dish_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_source_nutrition_to_meal_item"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_dish_item public.dish_items%rowtype;
  v_pantry public.pantry_items%rowtype;
begin
  if new.dish_item_id is not null then
    select * into v_dish_item from public.dish_items where id = new.dish_item_id;
  end if;
  if coalesce(v_dish_item.pantry_item_id, new.pantry_item_id) is not null then
    select * into v_pantry from public.pantry_items
    where id = coalesce(v_dish_item.pantry_item_id, new.pantry_item_id);
  end if;

  new.alcohol_abv := coalesce(new.alcohol_abv, v_pantry.alcohol_abv, v_dish_item.alcohol_abv);
  if v_pantry.id is not null then
    new.calories := public.alcohol_adjusted_calories((v_pantry.calories_100g * new.quantity_g / 100)::numeric, new.quantity_g::numeric, v_pantry.alcohol_abv, new.alcohol_abv, new.unit);
    new.protein_g := round((v_pantry.protein_100g * new.quantity_g / 100)::numeric, 1);
    new.carbs_g := round((v_pantry.carbs_100g * new.quantity_g / 100)::numeric, 1);
    new.fat_g := round((v_pantry.fat_100g * new.quantity_g / 100)::numeric, 1);
    if v_pantry.fiber_100g is not null then
      new.fiber_g := round((v_pantry.fiber_100g * new.quantity_g / 100)::numeric, 2);
    elsif v_dish_item.id is not null and v_dish_item.fiber_g is not null then
      new.fiber_g := round((v_dish_item.fiber_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2);
    end if;
    if v_pantry.sugars_100g is not null then
      new.sugars_g := round((v_pantry.sugars_100g * new.quantity_g / 100)::numeric, 2);
    elsif v_dish_item.id is not null and v_dish_item.sugars_g is not null then
      new.sugars_g := round((v_dish_item.sugars_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2);
    end if;
    if v_pantry.salt_100g is not null then
      new.salt_g := round((v_pantry.salt_100g * new.quantity_g / 100)::numeric, 2);
    elsif v_dish_item.id is not null and v_dish_item.salt_g is not null then
      new.salt_g := round((v_dish_item.salt_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2);
    end if;
  elsif v_dish_item.id is not null then
    new.calories := public.alcohol_adjusted_calories((v_dish_item.calories * new.quantity_g / v_dish_item.quantity_g)::numeric, new.quantity_g::numeric, v_dish_item.alcohol_abv, new.alcohol_abv, new.unit);
    new.protein_g := round((v_dish_item.protein_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 1);
    new.carbs_g := round((v_dish_item.carbs_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 1);
    new.fat_g := round((v_dish_item.fat_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 1);
    new.fiber_g := case when v_dish_item.fiber_g is null then null
      else round((v_dish_item.fiber_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2) end;
    new.sugars_g := case when v_dish_item.sugars_g is null then null
      else round((v_dish_item.sugars_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2) end;
    new.salt_g := case when v_dish_item.salt_g is null then null
      else round((v_dish_item.salt_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2) end;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."apply_source_nutrition_to_meal_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_gym_plan_position"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."assign_gym_plan_position"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_meal_item_position"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.position is null then
    perform 1 from public.meal_entries where id = new.entry_id for update;
    select coalesce(max(position), -1) + 1 into new.position
    from public.meal_items where entry_id = new.entry_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_meal_item_position"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_prepared_batch"("p_batch_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  update public.prepared_batches set closed_at = now()
  where id = p_batch_id and user_id = auth.uid() and closed_at is null;
  if not found then
    raise exception 'prepared dish not found' using errcode = 'P0002';
  end if;
end;
$$;


ALTER FUNCTION "public"."close_prepared_batch"("p_batch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_health_onboarding"("p_profile" "jsonb", "p_goals" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."complete_health_onboarding"("p_profile" "jsonb", "p_goals" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."consume_prepared_batch"("p_batch_id" "uuid", "p_date" "date", "p_meal_type" "text", "p_grams" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_batch public.prepared_batches%rowtype;
  v_name text;
  v_result jsonb;
  v_entry public.meal_entries%rowtype;
begin
  select * into v_batch from public.prepared_batches
  where id = p_batch_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'prepared dish not found' using errcode = 'P0002';
  end if;
  if v_batch.closed_at is not null or p_grams is null or p_grams <= 0
    or p_grams > v_batch.remaining_g then
    raise exception 'invalid prepared portion' using errcode = '22023';
  end if;
  select name into v_name from public.dishes where id = v_batch.snapshot_dish_id;
  v_result := public.add_meal_entry(
    v_batch.user_id, p_date, p_meal_type, v_name,
    public.prepared_portion_items(p_batch_id, p_grams), v_batch.snapshot_dish_id
  );
  update public.meal_entries
  set prepared_batch_id = p_batch_id, cooked_portion_g = p_grams
  where id = (v_result->'entry'->>'id')::uuid
  returning * into v_entry;
  return jsonb_set(v_result, '{entry}',
    to_jsonb(v_entry) || jsonb_build_object('items', v_result->'entry'->'items'));
end;
$$;


ALTER FUNCTION "public"."consume_prepared_batch"("p_batch_id" "uuid", "p_date" "date", "p_meal_type" "text", "p_grams" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_dish_with_categories"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_meal_types" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
begin
  if p_meal_types is null or cardinality(p_meal_types) = 0
    or exists (select 1 from unnest(p_meal_types) as t(value)
      where t.value is null or t.value not in ('breakfast','lunch','dinner','snack')) then
    raise exception 'invalid dish meal types' using errcode = '22023';
  end if;
  v_result := public.create_dish_with_items(p_user_id, p_name, p_items);
  update public.dishes set meal_types = p_meal_types
  where id = (v_result->>'id')::uuid and user_id = auth.uid();
  return jsonb_set(v_result, '{meal_types}', to_jsonb(p_meal_types));
end;
$$;


ALTER FUNCTION "public"."create_dish_with_categories"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_meal_types" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_dish_with_items"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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
      dish_id, position, food_name, quantity_g, piece_count, piece_size, unit, alcohol_abv, category, food_key, pantry_item_id,
      calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, source,
      off_food_id
    )
    select
      v_dish.id, (element.ordinal - 1)::integer, x.food_name, x.quantity_g, x.piece_count, x.piece_size, coalesce(x.unit, 'g'), x.alcohol_abv, coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories, x.protein_g,
      x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
      coalesce(x.source, 'manual'), x.off_food_id
    from jsonb_array_elements(p_items) with ordinality as element(value, ordinal)
    cross join lateral jsonb_to_record(element.value) as x(
      food_name text, quantity_g float, piece_count float, piece_size text, unit text, alcohol_abv numeric, category text, food_key text, pantry_item_id uuid, calories float, protein_g float,
      carbs_g float, fat_g float, fiber_g float, sugars_g float, salt_g float,
      source text, off_food_id text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.position), '[]'::jsonb) into v_items from inserted;

  return to_jsonb(v_dish) || jsonb_build_object('items', v_items);
end;
$$;


ALTER FUNCTION "public"."create_dish_with_items"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_prepared_batch"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_source_dish_id" "uuid", "p_icon" "text", "p_total_cooked_g" numeric, "p_first_portion_g" numeric, "p_date" "date", "p_meal_type" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_snapshot jsonb;
  v_batch public.prepared_batches%rowtype;
  v_meal_result jsonb;
  v_meal_types text[];
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0 or p_total_cooked_g is null or p_total_cooked_g <= 0 then
    raise exception 'invalid preparation' using errcode = '22023';
  end if;
  if p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack') then
    raise exception 'invalid meal category' using errcode = '22023';
  end if;
  if p_source_dish_id is not null then
    select meal_types into v_meal_types from public.dishes
    where id = p_source_dish_id and user_id = p_user_id and not is_preparation;
    if not found then
      raise exception 'saved dish not found' using errcode = 'P0002';
    end if;
  else
    v_meal_types := array[p_meal_type];
  end if;
  v_snapshot := public.create_dish_with_items(p_user_id, p_name, p_items);
  update public.dishes set is_preparation = true, icon = p_icon, meal_types = v_meal_types
  where id = (v_snapshot->>'id')::uuid;
  insert into public.prepared_batches (
    user_id, snapshot_dish_id, source_dish_id, total_cooked_g, remaining_g
  ) values (
    p_user_id, (v_snapshot->>'id')::uuid, p_source_dish_id,
    p_total_cooked_g, p_total_cooked_g
  ) returning * into v_batch;
  if coalesce(p_first_portion_g, 0) > 0 then
    v_meal_result := public.consume_prepared_batch(
      v_batch.id, p_date, p_meal_type, p_first_portion_g
    );
  end if;
  return to_jsonb(v_batch) || jsonb_build_object('meal_result', v_meal_result);
end;
$$;


ALTER FUNCTION "public"."create_prepared_batch"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_source_dish_id" "uuid", "p_icon" "text", "p_total_cooked_g" numeric, "p_first_portion_g" numeric, "p_date" "date", "p_meal_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_profile_invitation"("p_profile_id" "uuid", "p_email" "text", "p_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_invited_user_id uuid;
  v_recent_count    int;
BEGIN
  -- Verifica che il chiamante sia owner del profilo
  IF NOT public.is_profile_owner(p_profile_id, auth.uid()) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  -- Rate limiting: max 10 inviti nell'ultima ora
  SELECT COUNT(*) INTO v_recent_count
  FROM public.profile_share_invitations
  WHERE invited_by = auth.uid()
    AND created_at > now() - interval '1 hour';

  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  -- Lookup email — risultato mai esposto al client (SECURITY DEFINER)
  SELECT id INTO v_invited_user_id FROM auth.users WHERE email = p_email LIMIT 1;

  -- Se l'utente non esiste: ritorna silenziosamente (anti-enumeration)
  IF v_invited_user_id IS NULL THEN RETURN; END IF;

  -- Già membro: blocca con errore visibile (non è una info sensibile)
  IF EXISTS (
    SELECT 1 FROM public.profile_members
    WHERE profile_id = p_profile_id AND user_id = v_invited_user_id
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  -- Invito già pending: blocca
  IF EXISTS (
    SELECT 1 FROM public.profile_share_invitations
    WHERE profile_id = p_profile_id
      AND invited_email = p_email
      AND status = 'pending'
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'invite_pending';
  END IF;

  -- Crea invito
  INSERT INTO public.profile_share_invitations (profile_id, invited_email, invited_by, role)
  VALUES (p_profile_id, p_email, auth.uid(), p_role);
END;
$$;


ALTER FUNCTION "public"."create_profile_invitation"("p_profile_id" "uuid", "p_email" "text", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_meal_entry"("p_entry_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_meal_id uuid;
  v_user_id uuid;
begin
  select e.meal_id, m.user_id into v_meal_id, v_user_id
  from public.meal_entries e join public.meals m on m.id = e.meal_id
  where e.id = p_entry_id and m.user_id = auth.uid();
  if not found then
    raise exception 'meal entry not found' using errcode = 'P0002';
  end if;
  delete from public.meal_entries where id = p_entry_id;
  delete from public.meals m
  where m.id = v_meal_id and m.user_id = v_user_id
    and not exists (select 1 from public.meal_entries e where e.meal_id = m.id);
end;
$$;


ALTER FUNCTION "public"."delete_meal_entry"("p_entry_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_profiles"() RETURNS TABLE("id" "uuid", "uid" "uuid", "name" "text", "role" "text", "created_at" timestamp with time zone, "member_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Safety net: crea profilo e membership se mancano (es. trigger non ancora eseguito)
  INSERT INTO public.profiles (id, user_id, name)
  VALUES (v_uid, v_uid, 'Principale')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.profile_members (profile_id, user_id, role, email)
  SELECT p.id, p.user_id, 'owner', u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.user_id = v_uid
  ON CONFLICT (profile_id, user_id) DO NOTHING;

  RETURN QUERY
  SELECT
    p.id,
    p.user_id,           -- alias 'uid' in RETURNS TABLE → evita ambiguità con colonne omonime
    p.name,
    pm.role,
    p.created_at,
    (SELECT COUNT(*) FROM public.profile_members pm2 WHERE pm2.profile_id = p.id)
  FROM public.profiles p
  JOIN public.profile_members pm ON pm.profile_id = p.id AND pm.user_id = v_uid
  ORDER BY p.created_at;
END;
$$;


ALTER FUNCTION "public"."get_my_profiles"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, user_id, name)
  VALUES (new.id, new.id, 'Principale');
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_profile_user_id uuid;
  v_existing_portfolio_ids bigint[];
  v_rec jsonb;
  v_accounts_count integer := 0;
  v_categories_count integer := 0;
  v_subcategories_count integer := 0;
  v_portfolios_count integer := 0;
  v_transactions_count integer := 0;
  v_transfers_count integer := 0;
  v_orders_count integer := 0;
  v_recurring_count integer := 0;
  v_new_account_id bigint;
  v_new_category_id bigint;
  v_new_portfolio_id bigint;
  v_new_transaction_id bigint;
  v_transaction_id bigint;
  v_portfolio_id bigint;
  v_account_id bigint;
  v_new_recurring_id integer;
  v_inserted_rows integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select user_id
    into v_profile_user_id
  from public.profiles
  where id = p_profile_id
  for update;

  if v_profile_user_id is null then
    raise exception 'Profile not found';
  end if;

  if v_profile_user_id <> auth.uid() then
    raise exception 'Forbidden';
  end if;

  v_user_id := v_profile_user_id;

  create temp table tmp_account_map (
    source_conto_id integer primary key,
    account_id bigint not null
  ) on commit drop;

  create temp table tmp_category_map (
    category_key text primary key,
    category_id bigint not null
  ) on commit drop;

  create temp table tmp_portfolio_map (
    source_conto_id integer primary key,
    portfolio_id bigint not null
  ) on commit drop;

  create temp table tmp_transaction_map (
    transaction_key text primary key,
    transaction_id bigint not null
  ) on commit drop;

  create temp table tmp_recurring_map (
    recurring_key text primary key,
    recurring_id integer not null
  ) on commit drop;

  select array_agg(id)
    into v_existing_portfolio_ids
  from public.portfolios
  where profile_id = p_profile_id;

  delete from public.recurring_transactions
  where profile_id = p_profile_id;

  if coalesce(array_length(v_existing_portfolio_ids, 1), 0) > 0 then
    delete from public.orders
    where portfolio_id = any(v_existing_portfolio_ids);
  end if;

  delete from public.transactions
  where profile_id = p_profile_id;

  delete from public.transfers
  where profile_id = p_profile_id;

  delete from public.accounts
  where profile_id = p_profile_id;

  delete from public.categories
  where profile_id = p_profile_id;

  delete from public.portfolios
  where profile_id = p_profile_id;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'portfolios', '[]'::jsonb))
  loop
    insert into public.portfolios (
      user_id,
      profile_id,
      name,
      initial_capital,
      reference_currency,
      risk_free_source,
      market_benchmark,
      icon,
      color,
      history_mode
    ) values (
      v_user_id,
      p_profile_id,
      coalesce(v_rec->>'name', ''),
      coalesce((v_rec->>'initial_capital')::double precision, 0),
      coalesce(nullif(v_rec->>'reference_currency', ''), 'EUR'),
      coalesce(nullif(v_rec->>'risk_free_source', ''), 'auto'),
      coalesce(nullif(v_rec->>'market_benchmark', ''), 'auto'),
      nullif(v_rec->>'icon', ''),
      nullif(v_rec->>'color', ''),
      coalesce(nullif(v_rec->>'history_mode', ''), 'full_orders')
    )
    returning id into v_new_portfolio_id;

    insert into tmp_portfolio_map (source_conto_id, portfolio_id)
    values ((v_rec->>'source_conto_id')::integer, v_new_portfolio_id);

    v_portfolios_count := v_portfolios_count + 1;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'accounts', '[]'::jsonb))
  loop
    insert into public.accounts (
      user_id,
      profile_id,
      name,
      icon,
      initial_balance
    ) values (
      v_user_id,
      p_profile_id,
      coalesce(v_rec->>'name', ''),
      coalesce(nullif(v_rec->>'icon', ''), '🏦'),
      coalesce((v_rec->>'initial_balance')::double precision, 0)
    )
    returning id into v_new_account_id;

    insert into tmp_account_map (source_conto_id, account_id)
    values ((v_rec->>'source_conto_id')::integer, v_new_account_id);

    v_accounts_count := v_accounts_count + 1;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'categories', '[]'::jsonb))
  loop
    insert into public.categories (
      user_id,
      profile_id,
      name,
      icon,
      category_type,
      color
    ) values (
      v_user_id,
      p_profile_id,
      coalesce(v_rec->>'name', ''),
      coalesce(nullif(v_rec->>'icon', ''), case when v_rec->>'type' = 'income' then '💰' else '💸' end),
      nullif(v_rec->>'type', ''),
      nullif(v_rec->>'color', '')
    )
    returning id into v_new_category_id;

    insert into tmp_category_map (category_key, category_id)
    values (
      coalesce(v_rec->>'key', lower(coalesce(v_rec->>'name', '')) || '|' || coalesce(v_rec->>'type', '')),
      v_new_category_id
    );

    v_categories_count := v_categories_count + 1;

    insert into public.subcategories (category_id, name)
    select v_new_category_id, value
    from jsonb_array_elements_text(coalesce(v_rec->'subcategories', '[]'::jsonb));

    get diagnostics v_inserted_rows = row_count;
    v_subcategories_count := v_subcategories_count + v_inserted_rows;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'recurring_transactions', '[]'::jsonb))
  loop
    select account_id into v_account_id
    from tmp_account_map
    where source_conto_id = (v_rec->>'source_conto_id')::integer;

    if v_account_id is null then
      raise exception 'Missing recurring account mapping for source_conto_id %', v_rec->>'source_conto_id';
    end if;

    v_portfolio_id := null;
    if nullif(v_rec->>'source_portfolio_conto_id', '') is not null then
      select portfolio_id into v_portfolio_id
      from tmp_portfolio_map
      where source_conto_id = (v_rec->>'source_portfolio_conto_id')::integer;
    end if;

    insert into public.recurring_transactions (
      user_id,
      profile_id,
      account_id,
      type,
      portfolio_id,
      category,
      subcategory,
      amount,
      description,
      frequency,
      start_date,
      next_due_date,
      ticker,
      isin,
      instrument_name,
      exchange,
      instrument_type,
      order_type,
      currency,
      quantity,
      price
    ) values (
      v_user_id,
      p_profile_id,
      v_account_id,
      v_rec->>'type',
      v_portfolio_id,
      v_rec->>'category',
      nullif(v_rec->>'subcategory', ''),
      coalesce((v_rec->>'amount')::numeric, 0),
      nullif(v_rec->>'description', ''),
      v_rec->>'frequency',
      (v_rec->>'start_date')::date,
      (v_rec->>'next_due_date')::date,
      nullif(v_rec->>'ticker', ''),
      nullif(v_rec->>'isin', ''),
      nullif(v_rec->>'instrument_name', ''),
      nullif(v_rec->>'exchange', ''),
      nullif(v_rec->>'instrument_type', ''),
      nullif(v_rec->>'order_type', ''),
      nullif(v_rec->>'currency', ''),
      nullif(v_rec->>'quantity', '')::numeric,
      nullif(v_rec->>'price', '')::numeric
    )
    returning id into v_new_recurring_id;

    if nullif(v_rec->>'recurring_key', '') is not null then
      insert into tmp_recurring_map (recurring_key, recurring_id)
      values (v_rec->>'recurring_key', v_new_recurring_id);
    end if;

    v_recurring_count := v_recurring_count + 1;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'transactions', '[]'::jsonb))
  loop
    select account_id into v_account_id
    from tmp_account_map
    where source_conto_id = (v_rec->>'source_conto_id')::integer;

    if v_account_id is null then
      raise exception 'Missing account mapping for source_conto_id %', v_rec->>'source_conto_id';
    end if;

    insert into public.transactions (
      user_id,
      profile_id,
      account_id,
      type,
      category,
      subcategory,
      amount,
      description,
      date,
      ticker,
      quantity,
      price,
      recurring_id
    ) values (
      v_user_id,
      p_profile_id,
      v_account_id,
      v_rec->>'type',
      v_rec->>'category',
      nullif(v_rec->>'subcategory', ''),
      coalesce((v_rec->>'amount')::double precision, 0),
      nullif(v_rec->>'description', ''),
      (v_rec->>'date')::date,
      nullif(v_rec->>'ticker', ''),
      nullif(v_rec->>'quantity', '')::double precision,
      nullif(v_rec->>'price', '')::double precision,
      (select recurring_id from tmp_recurring_map where recurring_key = nullif(v_rec->>'recurring_key', ''))
    )
    returning id into v_new_transaction_id;

    if nullif(v_rec->>'transaction_key', '') is not null then
      insert into tmp_transaction_map (transaction_key, transaction_id)
      values (v_rec->>'transaction_key', v_new_transaction_id);
    end if;

    v_transactions_count := v_transactions_count + 1;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'transfers', '[]'::jsonb))
  loop
    insert into public.transfers (
      user_id,
      profile_id,
      from_account_id,
      to_account_id,
      amount,
      description,
      date
    ) values (
      v_user_id,
      p_profile_id,
      (select account_id from tmp_account_map where source_conto_id = (v_rec->>'from_source_conto_id')::integer),
      (select account_id from tmp_account_map where source_conto_id = (v_rec->>'to_source_conto_id')::integer),
      coalesce((v_rec->>'amount')::numeric, 0),
      nullif(v_rec->>'description', ''),
      (v_rec->>'date')::date
    );
    v_transfers_count := v_transfers_count + 1;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'orders', '[]'::jsonb))
  loop
    select portfolio_id into v_portfolio_id
    from tmp_portfolio_map
    where source_conto_id = (v_rec->>'source_portfolio_conto_id')::integer;

    if v_portfolio_id is null then
      raise exception 'Missing portfolio mapping for source_portfolio_conto_id %', v_rec->>'source_portfolio_conto_id';
    end if;

    v_transaction_id := null;
    if nullif(v_rec->>'transaction_key', '') is not null then
      select transaction_id into v_transaction_id
      from tmp_transaction_map
      where transaction_key = v_rec->>'transaction_key';
    end if;

    insert into public.orders (
      user_id,
      portfolio_id,
      symbol,
      isin,
      name,
      exchange,
      currency,
      quantity,
      price,
      commission,
      instrument_type,
      order_type,
      date,
      ter,
      transaction_id
    ) values (
      v_user_id,
      v_portfolio_id,
      v_rec->>'symbol',
      nullif(v_rec->>'isin', ''),
      nullif(v_rec->>'name', ''),
      nullif(v_rec->>'exchange', ''),
      coalesce(nullif(v_rec->>'currency', ''), 'EUR'),
      coalesce((v_rec->>'quantity')::numeric, 0),
      coalesce((v_rec->>'price')::numeric, 0),
      coalesce((v_rec->>'commission')::numeric, 0),
      v_rec->>'instrument_type',
      coalesce(nullif(v_rec->>'order_type', ''), 'buy'),
      (v_rec->>'date')::date,
      nullif(v_rec->>'ter', '')::numeric,
      v_transaction_id
    );

    v_orders_count := v_orders_count + 1;
  end loop;

  return jsonb_build_object(
    'accounts', v_accounts_count,
    'categories', v_categories_count,
    'subcategories', v_subcategories_count,
    'portfolios', v_portfolios_count,
    'transactions', v_transactions_count,
    'transfers', v_transfers_count,
    'orders', v_orders_count,
    'recurring', v_recurring_count
  );
end;
$$;


ALTER FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_profile_member"("p_profile_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_members
    WHERE profile_id = p_profile_id AND user_id = p_user_id
  );
$$;


ALTER FUNCTION "public"."is_profile_member"("p_profile_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_profile_owner"("p_profile_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_members
    WHERE profile_id = p_profile_id AND user_id = p_user_id AND role = 'owner'
  );
$$;


ALTER FUNCTION "public"."is_profile_owner"("p_profile_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepared_portion_items"("p_batch_id" "uuid", "p_grams" numeric) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'dish_item_id', di.id,
    'is_customization', false,
    'food_name', di.food_name,
    'quantity_g', di.quantity_g * p_grams / b.total_cooked_g,
    'piece_count', case when di.piece_count is null then null
      else di.piece_count * p_grams / b.total_cooked_g end,
    'piece_size', di.piece_size,
    'unit', di.unit,
    'alcohol_abv', di.alcohol_abv,
    'category', di.category,
    'food_key', di.food_key,
    'pantry_item_id', di.pantry_item_id,
    'calories', di.calories * p_grams / b.total_cooked_g,
    'protein_g', di.protein_g * p_grams / b.total_cooked_g,
    'carbs_g', di.carbs_g * p_grams / b.total_cooked_g,
    'fat_g', di.fat_g * p_grams / b.total_cooked_g,
    'fiber_g', di.fiber_g * p_grams / b.total_cooked_g,
    'sugars_g', di.sugars_g * p_grams / b.total_cooked_g,
    'salt_g', di.salt_g * p_grams / b.total_cooked_g,
    'source', di.source,
    'off_food_id', di.off_food_id
  ) order by di.position), '[]'::jsonb)
  from public.prepared_batches b
  join public.dish_items di on di.dish_id = b.snapshot_dish_id
  where b.id = p_batch_id and b.user_id = auth.uid();
$$;


ALTER FUNCTION "public"."prepared_portion_items"("p_batch_id" "uuid", "p_grams" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_gym_plans"("p_plan_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."reorder_gym_plans"("p_plan_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."repair_own_membership"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profile_members (profile_id, user_id, role, email)
  SELECT p.id, p.user_id, 'owner', u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.user_id = auth.uid()
  ON CONFLICT (profile_id, user_id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."repair_own_membership"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_gym_plan"("p_user_id" "uuid", "p_plan_id" "uuid", "p_name" "text", "p_exercises" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."save_gym_plan"("p_user_id" "uuid", "p_plan_id" "uuid", "p_name" "text", "p_exercises" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_dish_item_unit_from_ingredient"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.pantry_item_id is not null then
    select p.nutrition_unit into new.unit from public.pantry_items p
    where p.id = new.pantry_item_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_dish_item_unit_from_ingredient"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_gym_session"("p_user_id" "uuid", "p_plan_id" "uuid", "p_date" "date") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."start_gym_session"("p_user_id" "uuid", "p_plan_id" "uuid", "p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_pantry_nutrition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  update public.dish_items di set
    calories = case when new.calories_100g is distinct from old.calories_100g
      then round((new.calories_100g * di.quantity_g / 100)::numeric) else di.calories end,
    protein_g = case when new.protein_100g is distinct from old.protein_100g
      then round((new.protein_100g * di.quantity_g / 100)::numeric, 1) else di.protein_g end,
    carbs_g = case when new.carbs_100g is distinct from old.carbs_100g
      then round((new.carbs_100g * di.quantity_g / 100)::numeric, 1) else di.carbs_g end,
    fat_g = case when new.fat_100g is distinct from old.fat_100g
      then round((new.fat_100g * di.quantity_g / 100)::numeric, 1) else di.fat_g end,
    fiber_g = case when new.fiber_100g is distinct from old.fiber_100g
      then round((new.fiber_100g * di.quantity_g / 100)::numeric, 2) else di.fiber_g end,
    sugars_g = case when new.sugars_100g is distinct from old.sugars_100g
      then round((new.sugars_100g * di.quantity_g / 100)::numeric, 2) else di.sugars_g end,
    salt_g = case when new.salt_100g is distinct from old.salt_100g
      then round((new.salt_100g * di.quantity_g / 100)::numeric, 2) else di.salt_g end,
    alcohol_abv = case when new.alcohol_abv is distinct from old.alcohol_abv
      and (di.alcohol_abv is null or di.alcohol_abv is not distinct from old.alcohol_abv)
      then new.alcohol_abv else di.alcohol_abv end
  where di.pantry_item_id = new.id;

  update public.meal_items mi set
    calories = case when new.calories_100g is distinct from old.calories_100g
      then round((new.calories_100g * mi.quantity_g / 100)::numeric) else mi.calories end,
    protein_g = case when new.protein_100g is distinct from old.protein_100g
      then round((new.protein_100g * mi.quantity_g / 100)::numeric, 1) else mi.protein_g end,
    carbs_g = case when new.carbs_100g is distinct from old.carbs_100g
      then round((new.carbs_100g * mi.quantity_g / 100)::numeric, 1) else mi.carbs_g end,
    fat_g = case when new.fat_100g is distinct from old.fat_100g
      then round((new.fat_100g * mi.quantity_g / 100)::numeric, 1) else mi.fat_g end,
    fiber_g = case when new.fiber_100g is distinct from old.fiber_100g
      then round((new.fiber_100g * mi.quantity_g / 100)::numeric, 2) else mi.fiber_g end,
    sugars_g = case when new.sugars_100g is distinct from old.sugars_100g
      then round((new.sugars_100g * mi.quantity_g / 100)::numeric, 2) else mi.sugars_g end,
    salt_g = case when new.salt_100g is distinct from old.salt_100g
      then round((new.salt_100g * mi.quantity_g / 100)::numeric, 2) else mi.salt_g end,
    alcohol_abv = case when new.alcohol_abv is distinct from old.alcohol_abv
      and (mi.alcohol_abv is null or mi.alcohol_abv is not distinct from old.alcohol_abv)
      then new.alcohol_abv else mi.alcohol_abv end
  where exists (
    select 1 from public.dish_items di
    where di.id = mi.dish_item_id and di.pantry_item_id = new.id
  ) or (
    mi.pantry_item_id = new.id and not exists (
      select 1 from public.dish_items di
      where di.id = mi.dish_item_id and di.pantry_item_id is not null
    )
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_pantry_nutrition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_dish_with_categories"("p_dish_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_meal_types" "text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_result jsonb;
begin
  if p_meal_types is null or cardinality(p_meal_types) = 0
    or exists (select 1 from unnest(p_meal_types) as t(value)
      where t.value is null or t.value not in ('breakfast','lunch','dinner','snack')) then
    raise exception 'invalid dish meal types' using errcode = '22023';
  end if;
  v_result := public.update_dish_with_items(p_dish_id, p_name, p_items);
  update public.dishes set meal_types = p_meal_types
  where id = p_dish_id and user_id = auth.uid();
  return jsonb_set(v_result, '{meal_types}', to_jsonb(p_meal_types));
end;
$$;


ALTER FUNCTION "public"."update_dish_with_categories"("p_dish_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_meal_types" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_dish_with_items"("p_dish_id" "uuid", "p_name" "text", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_dish public.dishes%rowtype;
  v_element record;
  v_item_id uuid;
  v_offset integer;
  v_items jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as element(value)
    where element.value->>'id' is not null
    group by element.value->>'id' having count(*) > 1
  ) then
    raise exception 'duplicate dish ingredient' using errcode = '22023';
  end if;

  update public.dishes
  set name = trim(p_name), updated_at = now()
  where id = p_dish_id and user_id = auth.uid()
  returning * into v_dish;
  if not found then
    raise exception 'dish not found' using errcode = 'P0002';
  end if;

  -- Move old positions beyond the new range, preserving IDs for retained items.
  select coalesce(max(position), -1) + jsonb_array_length(p_items) + 1
  into v_offset from public.dish_items where dish_id = p_dish_id;
  update public.dish_items set position = position + v_offset where dish_id = p_dish_id;

  for v_element in
    select value, ordinality from jsonb_array_elements(p_items) with ordinality
  loop
    v_item_id := nullif(v_element.value->>'id', '')::uuid;
    if v_item_id is not null then
      update public.dish_items di set
        position = (v_element.ordinality - 1)::integer,
        food_name = x.food_name, quantity_g = x.quantity_g,
        piece_count = x.piece_count, piece_size = x.piece_size,
        unit = coalesce(x.unit, di.unit), alcohol_abv = x.alcohol_abv,
        category = coalesce(x.category, 'other'), food_key = x.food_key,
        pantry_item_id = x.pantry_item_id, calories = x.calories,
        protein_g = x.protein_g, carbs_g = x.carbs_g, fat_g = x.fat_g,
        fiber_g = x.fiber_g, sugars_g = x.sugars_g, salt_g = x.salt_g,
        source = coalesce(x.source, 'manual'), off_food_id = x.off_food_id
      from jsonb_to_record(v_element.value) as x(
        food_name text, quantity_g float, piece_count float, piece_size text, unit text, alcohol_abv numeric, category text, food_key text,
        pantry_item_id uuid, calories float, protein_g float, carbs_g float,
        fat_g float, fiber_g float, sugars_g float, salt_g float,
        source text, off_food_id text
      )
      where di.id = v_item_id and di.dish_id = p_dish_id and di.position >= v_offset;
      if not found then
        raise exception 'dish ingredient not found' using errcode = 'P0002';
      end if;
    else
      insert into public.dish_items (
        dish_id, position, food_name, quantity_g, piece_count, piece_size, unit, alcohol_abv, category, food_key, pantry_item_id,
        calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, source, off_food_id
      )
      select p_dish_id, (v_element.ordinality - 1)::integer, x.food_name, x.quantity_g,
        x.piece_count, x.piece_size, coalesce(x.unit, 'g'), x.alcohol_abv, coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories,
        x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
        coalesce(x.source, 'manual'), x.off_food_id
      from jsonb_to_record(v_element.value) as x(
        food_name text, quantity_g float, piece_count float, piece_size text, unit text, alcohol_abv numeric, category text, food_key text,
        pantry_item_id uuid, calories float, protein_g float, carbs_g float,
        fat_g float, fiber_g float, sugars_g float, salt_g float,
        source text, off_food_id text
      );
    end if;
  end loop;

  delete from public.dish_items where dish_id = p_dish_id and position >= v_offset;

  -- Recalculate logged portions from the current per-gram values. Quantities,
  -- added extras, pantry usage and unrelated diary entries stay intact.
  update public.meal_items mi set
    calories = round((di.calories * mi.quantity_g / di.quantity_g)::numeric),
    protein_g = round((di.protein_g * mi.quantity_g / di.quantity_g)::numeric, 1),
    carbs_g = round((di.carbs_g * mi.quantity_g / di.quantity_g)::numeric, 1),
    fat_g = round((di.fat_g * mi.quantity_g / di.quantity_g)::numeric, 1),
    fiber_g = round((di.fiber_g * mi.quantity_g / di.quantity_g)::numeric, 2),
    sugars_g = round((di.sugars_g * mi.quantity_g / di.quantity_g)::numeric, 2),
    salt_g = round((di.salt_g * mi.quantity_g / di.quantity_g)::numeric, 2),
    alcohol_abv = di.alcohol_abv
  from public.dish_items di, public.meal_entries e
  where mi.dish_item_id = di.id and mi.entry_id = e.id
    and e.dish_id = p_dish_id and di.dish_id = p_dish_id;

  select coalesce(jsonb_agg(to_jsonb(di) order by di.position), '[]'::jsonb)
  into v_items from public.dish_items di where di.dish_id = p_dish_id;

  return to_jsonb(v_dish) || jsonb_build_object('items', v_items);
end;
$$;


ALTER FUNCTION "public"."update_dish_with_items"("p_dish_id" "uuid", "p_name" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_meal_entry"("p_entry_id" "uuid", "p_name" "text", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_entry public.meal_entries%rowtype;
  v_items jsonb;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array' using errcode = '22023';
  end if;
  update public.meal_entries e set name = trim(p_name)
  from public.meals m
  where e.id = p_entry_id and m.id = e.meal_id and m.user_id = auth.uid()
  returning e.* into v_entry;
  if not found then
    raise exception 'meal entry not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(dish_item_id uuid)
    where x.dish_item_id is not null and not exists (
      select 1 from public.dish_items di
      where di.id = x.dish_item_id and di.dish_id = v_entry.dish_id
    )
  ) then
    raise exception 'dish ingredient not found' using errcode = 'P0002';
  end if;
  delete from public.meal_items where entry_id = p_entry_id;
  insert into public.meal_items (
    meal_id, entry_id, position, dish_item_id, is_customization, food_name, quantity_g,
    piece_count, piece_size, unit, category, food_key, pantry_item_id,
    calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, alcohol_abv, source, off_food_id
  )
  select v_entry.meal_id, v_entry.id, (element.ordinal - 1)::integer, x.dish_item_id,
    coalesce(x.is_customization, v_entry.dish_id is not null and x.dish_item_id is null),
    x.food_name, x.quantity_g, x.piece_count, x.piece_size, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id,
    x.calories, x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g,
    x.salt_g, x.alcohol_abv, coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_array_elements(p_items) with ordinality as element(value, ordinal)
  cross join lateral jsonb_to_record(element.value) as x(
    dish_item_id uuid, is_customization boolean, food_name text, quantity_g float,
    piece_count float, piece_size text, unit text, category text, food_key text,
    pantry_item_id uuid, calories float, protein_g float, carbs_g float,
    fat_g float, fiber_g float, sugars_g float, salt_g float, alcohol_abv numeric, source text, off_food_id text
  );
  select coalesce(jsonb_agg(to_jsonb(mi) order by mi.position), '[]'::jsonb)
  into v_items from public.meal_items mi where mi.entry_id = v_entry.id;
  return to_jsonb(v_entry) || jsonb_build_object('items', v_items);
end;
$$;


ALTER FUNCTION "public"."update_meal_entry"("p_entry_id" "uuid", "p_name" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_prepared_portion"("p_entry_id" "uuid", "p_grams" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_entry public.meal_entries%rowtype;
  v_batch public.prepared_batches%rowtype;
  v_result jsonb;
begin
  select e.* into v_entry from public.meal_entries e
  join public.meals m on m.id = e.meal_id
  where e.id = p_entry_id and m.user_id = auth.uid() for update of e;
  if not found or v_entry.prepared_batch_id is null then
    raise exception 'prepared portion not found' using errcode = 'P0002';
  end if;
  select * into v_batch from public.prepared_batches
  where id = v_entry.prepared_batch_id and user_id = auth.uid() for update;
  if not found or p_grams is null or p_grams <= 0
    or p_grams > v_batch.remaining_g + v_entry.cooked_portion_g then
    raise exception 'invalid prepared portion' using errcode = '22023';
  end if;
  v_result := public.update_meal_entry(
    p_entry_id, v_entry.name, public.prepared_portion_items(v_batch.id, p_grams)
  );
  update public.meal_entries set cooked_portion_g = p_grams
  where id = p_entry_id returning * into v_entry;
  return to_jsonb(v_entry) || jsonb_build_object('items', v_result->'items');
end;
$$;


ALTER FUNCTION "public"."update_prepared_portion"("p_entry_id" "uuid", "p_grams" numeric) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "icon" "text" DEFAULT '💳'::"text" NOT NULL,
    "initial_balance" double precision DEFAULT 0 NOT NULL,
    "is_favorite" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "profile_id" "uuid"
);


ALTER TABLE "public"."accounts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."accounts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."accounts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."accounts_id_seq" OWNED BY "public"."accounts"."id";



CREATE TABLE IF NOT EXISTS "public"."barcode_products" (
    "barcode" "text" NOT NULL,
    "name" "text" NOT NULL,
    "brand" "text",
    "package_quantity" "text",
    "quantity_value" double precision,
    "quantity_unit" "text",
    "serving_size" "text",
    "ingredients" "text",
    "allergens" "text",
    "calories_100g" double precision NOT NULL,
    "protein_100g" double precision NOT NULL,
    "carbs_100g" double precision NOT NULL,
    "fat_100g" double precision NOT NULL,
    "fiber_100g" double precision,
    "sugars_100g" double precision,
    "saturated_fat_100g" double precision,
    "unsaturated_fat_100g" double precision,
    "salt_100g" double precision,
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "source" "text" NOT NULL,
    "off_food_id" "text",
    "confidence" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "package_piece_count" integer,
    "package_net_quantity_value" double precision,
    "package_net_quantity_unit" "text",
    CONSTRAINT "barcode_products_barcode_check" CHECK ((("barcode" ~ '^[0-9]+$'::"text") AND ("length"("barcode") = ANY (ARRAY[8, 12, 13, 14])))),
    CONSTRAINT "barcode_products_calories_100g_check" CHECK (("calories_100g" >= (0)::double precision)),
    CONSTRAINT "barcode_products_carbs_100g_check" CHECK (("carbs_100g" >= (0)::double precision)),
    CONSTRAINT "barcode_products_category_check" CHECK (("category" = ANY (ARRAY['grain'::"text", 'bakery'::"text", 'legume'::"text", 'vegetable'::"text", 'fruit'::"text", 'nuts_seeds'::"text", 'meat'::"text", 'fish'::"text", 'dairy'::"text", 'egg'::"text", 'plant_protein'::"text", 'spread'::"text", 'fat'::"text", 'sauce'::"text", 'condiment'::"text", 'seasoning'::"text", 'sweet'::"text", 'snack'::"text", 'prepared'::"text", 'supplement'::"text", 'alcohol'::"text", 'beverage'::"text", 'other'::"text"]))),
    CONSTRAINT "barcode_products_confidence_check" CHECK ((("confidence" IS NULL) OR ("confidence" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"])))),
    CONSTRAINT "barcode_products_fat_100g_check" CHECK (("fat_100g" >= (0)::double precision)),
    CONSTRAINT "barcode_products_fiber_100g_check" CHECK ((("fiber_100g" IS NULL) OR ("fiber_100g" >= (0)::double precision))),
    CONSTRAINT "barcode_products_name_check" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "barcode_products_package_net_quantity_unit_check" CHECK ((("package_net_quantity_unit" IS NULL) OR ("package_net_quantity_unit" = ANY (ARRAY['g'::"text", 'ml'::"text"])))),
    CONSTRAINT "barcode_products_package_net_quantity_value_check" CHECK ((("package_net_quantity_value" IS NULL) OR ("package_net_quantity_value" > (0)::double precision))),
    CONSTRAINT "barcode_products_package_piece_count_check" CHECK ((("package_piece_count" IS NULL) OR ("package_piece_count" > 0))),
    CONSTRAINT "barcode_products_protein_100g_check" CHECK (("protein_100g" >= (0)::double precision)),
    CONSTRAINT "barcode_products_quantity_unit_check" CHECK ((("quantity_unit" IS NULL) OR ("quantity_unit" = ANY (ARRAY['g'::"text", 'ml'::"text", 'pz'::"text"])))),
    CONSTRAINT "barcode_products_quantity_value_check" CHECK ((("quantity_value" IS NULL) OR ("quantity_value" > (0)::double precision))),
    CONSTRAINT "barcode_products_salt_100g_check" CHECK ((("salt_100g" IS NULL) OR ("salt_100g" >= (0)::double precision))),
    CONSTRAINT "barcode_products_saturated_fat_100g_check" CHECK ((("saturated_fat_100g" IS NULL) OR ("saturated_fat_100g" >= (0)::double precision))),
    CONSTRAINT "barcode_products_source_check" CHECK (("source" = ANY (ARRAY['openfoodfacts'::"text", 'ai_photo'::"text"]))),
    CONSTRAINT "barcode_products_sugars_100g_check" CHECK ((("sugars_100g" IS NULL) OR ("sugars_100g" >= (0)::double precision))),
    CONSTRAINT "barcode_products_unsaturated_fat_100g_check" CHECK ((("unsaturated_fat_100g" IS NULL) OR ("unsaturated_fat_100g" >= (0)::double precision)))
);


ALTER TABLE "public"."barcode_products" OWNER TO "postgres";


COMMENT ON TABLE "public"."barcode_products" IS 'Shared read-only product cache populated by trusted Edge Functions from Open Food Facts or OpenAI';



COMMENT ON COLUMN "public"."barcode_products"."package_piece_count" IS 'Explicit package item count; never inferred by multiplying a serving weight';



COMMENT ON COLUMN "public"."barcode_products"."package_net_quantity_value" IS 'Explicit printed net package weight or volume';



COMMENT ON COLUMN "public"."barcode_products"."package_net_quantity_unit" IS 'Unit for the explicit printed net package quantity';



CREATE TABLE IF NOT EXISTS "public"."bond_metadata_cache" (
    "isin" "text" NOT NULL,
    "issuer" "text",
    "coupon" double precision,
    "maturity" "text",
    "currency" "text" DEFAULT 'EUR'::"text",
    "ytm_gross" double precision,
    "ytm_net" double precision,
    "duration" double precision,
    "coupon_frequency" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "name" "text" DEFAULT ''::"text"
);


ALTER TABLE "public"."bond_metadata_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "category_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "color" "text",
    "profile_id" "uuid",
    CONSTRAINT "categories_category_type_check" CHECK ((("category_type" = ANY (ARRAY['expense'::"text", 'income'::"text", 'investment'::"text", 'transfer'::"text"])) OR ("category_type" IS NULL)))
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."categories_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."categories_id_seq" OWNED BY "public"."categories"."id";



CREATE TABLE IF NOT EXISTS "public"."dish_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dish_id" "uuid" NOT NULL,
    "food_name" "text" NOT NULL,
    "quantity_g" double precision NOT NULL,
    "calories" double precision NOT NULL,
    "protein_g" double precision NOT NULL,
    "carbs_g" double precision NOT NULL,
    "fat_g" double precision NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "off_food_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "food_key" "text",
    "pantry_item_id" "uuid",
    "fiber_g" double precision,
    "sugars_g" double precision,
    "salt_g" double precision,
    "position" integer NOT NULL,
    "piece_count" double precision,
    "piece_size" "text",
    "unit" "text" DEFAULT 'g'::"text" NOT NULL,
    "alcohol_abv" numeric(5,2),
    CONSTRAINT "dish_items_alcohol_abv_check" CHECK ((("alcohol_abv" >= (0)::numeric) AND ("alcohol_abv" <= (100)::numeric))),
    CONSTRAINT "dish_items_category_check" CHECK (("category" = ANY (ARRAY['grain'::"text", 'bakery'::"text", 'legume'::"text", 'vegetable'::"text", 'fruit'::"text", 'nuts_seeds'::"text", 'meat'::"text", 'fish'::"text", 'dairy'::"text", 'egg'::"text", 'plant_protein'::"text", 'spread'::"text", 'fat'::"text", 'sauce'::"text", 'condiment'::"text", 'seasoning'::"text", 'sweet'::"text", 'snack'::"text", 'prepared'::"text", 'supplement'::"text", 'alcohol'::"text", 'beverage'::"text", 'other'::"text"]))),
    CONSTRAINT "dish_items_fiber_g_check" CHECK ((("fiber_g" IS NULL) OR ("fiber_g" >= (0)::double precision))),
    CONSTRAINT "dish_items_piece_count_check" CHECK ((("piece_count" IS NULL) OR ("piece_count" > (0)::double precision))),
    CONSTRAINT "dish_items_piece_pair" CHECK ((("piece_count" IS NULL) = ("piece_size" IS NULL))),
    CONSTRAINT "dish_items_piece_size_check" CHECK (("piece_size" = ANY (ARRAY['small'::"text", 'medium'::"text", 'large'::"text"]))),
    CONSTRAINT "dish_items_position_nonnegative" CHECK (("position" >= 0)),
    CONSTRAINT "dish_items_salt_g_check" CHECK ((("salt_g" IS NULL) OR ("salt_g" >= (0)::double precision))),
    CONSTRAINT "dish_items_sugars_g_check" CHECK ((("sugars_g" IS NULL) OR ("sugars_g" >= (0)::double precision))),
    CONSTRAINT "dish_items_unit_check" CHECK (("unit" = ANY (ARRAY['g'::"text", 'ml'::"text"])))
);


ALTER TABLE "public"."dish_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dishes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "icon" "text",
    "meal_types" "text"[] DEFAULT ARRAY['breakfast'::"text", 'lunch'::"text", 'dinner'::"text", 'snack'::"text"] NOT NULL,
    "is_preparation" boolean DEFAULT false NOT NULL,
    "cooking_signature" "text",
    "cooking_methods" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "measured_yield_ratio" numeric(10,5),
    CONSTRAINT "dishes_cooking_methods_check" CHECK (("jsonb_typeof"("cooking_methods") = 'array'::"text")),
    CONSTRAINT "dishes_icon_check" CHECK ((("icon" IS NULL) OR (("length"(TRIM(BOTH FROM "icon")) >= 1) AND ("length"(TRIM(BOTH FROM "icon")) <= 16)))),
    CONSTRAINT "dishes_meal_types_check" CHECK ((("cardinality"("meal_types") > 0) AND ("meal_types" <@ ARRAY['breakfast'::"text", 'lunch'::"text", 'dinner'::"text", 'snack'::"text"]))),
    CONSTRAINT "dishes_measured_yield_ratio_check" CHECK ((("measured_yield_ratio" IS NULL) OR ("measured_yield_ratio" > (0)::numeric)))
);


ALTER TABLE "public"."dishes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."etf_ucits_cache" (
    "isin" "text" NOT NULL,
    "ticker" "text" NOT NULL,
    "exchange" "text" NOT NULL,
    "name" "text" DEFAULT ''::"text",
    "currency" "text" DEFAULT ''::"text",
    "ter" double precision,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."etf_ucits_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gym_plan_exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "position" integer NOT NULL,
    "exercise_key" "text",
    "exercise_name" "text" NOT NULL,
    "equipment" "text" NOT NULL,
    "target_sets" integer NOT NULL,
    "target_reps" integer,
    "target_reps_max" integer,
    "per_side" boolean DEFAULT false NOT NULL,
    CONSTRAINT "gym_plan_exercises_equipment_check" CHECK (("length"(TRIM(BOTH FROM "equipment")) > 0)),
    CONSTRAINT "gym_plan_exercises_exercise_name_check" CHECK (("length"(TRIM(BOTH FROM "exercise_name")) > 0)),
    CONSTRAINT "gym_plan_exercises_position_check" CHECK (("position" >= 0)),
    CONSTRAINT "gym_plan_exercises_target_reps_check" CHECK ((("target_reps" >= 1) AND ("target_reps" <= 100))),
    CONSTRAINT "gym_plan_exercises_target_reps_max_check" CHECK ((("target_reps_max" >= 1) AND ("target_reps_max" <= 100))),
    CONSTRAINT "gym_plan_exercises_target_sets_check" CHECK ((("target_sets" >= 1) AND ("target_sets" <= 20))),
    CONSTRAINT "gym_plan_reps_range" CHECK ((("target_reps_max" IS NULL) OR (("target_reps" IS NOT NULL) AND ("target_reps_max" >= "target_reps"))))
);


ALTER TABLE "public"."gym_plan_exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gym_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "position" integer NOT NULL,
    CONSTRAINT "gym_plans_name_check" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "gym_plans_position_nonnegative" CHECK (("position" >= 0))
);


ALTER TABLE "public"."gym_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gym_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plan_id" "uuid",
    "plan_name" "text" NOT NULL,
    "date" "date" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."gym_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gym_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "exercise_position" integer NOT NULL,
    "exercise_key" "text",
    "exercise_name" "text" NOT NULL,
    "equipment" "text" NOT NULL,
    "set_number" integer NOT NULL,
    "target_reps" integer,
    "weight_kg" numeric(8,2),
    "reps" integer,
    "done" boolean DEFAULT false NOT NULL,
    "target_reps_max" integer,
    "per_side" boolean DEFAULT false NOT NULL,
    CONSTRAINT "gym_set_reps_range" CHECK ((("target_reps_max" IS NULL) OR (("target_reps" IS NOT NULL) AND ("target_reps_max" >= "target_reps")))),
    CONSTRAINT "gym_sets_check" CHECK (((NOT "done") OR ("reps" IS NOT NULL))),
    CONSTRAINT "gym_sets_equipment_check" CHECK (("length"(TRIM(BOTH FROM "equipment")) > 0)),
    CONSTRAINT "gym_sets_exercise_name_check" CHECK (("length"(TRIM(BOTH FROM "exercise_name")) > 0)),
    CONSTRAINT "gym_sets_exercise_position_check" CHECK (("exercise_position" >= 0)),
    CONSTRAINT "gym_sets_reps_check" CHECK (("reps" > 0)),
    CONSTRAINT "gym_sets_set_number_check" CHECK (("set_number" > 0)),
    CONSTRAINT "gym_sets_target_reps_check" CHECK ((("target_reps" >= 1) AND ("target_reps" <= 100))),
    CONSTRAINT "gym_sets_target_reps_max_check" CHECK ((("target_reps_max" >= 1) AND ("target_reps_max" <= 100))),
    CONSTRAINT "gym_sets_weight_kg_check" CHECK (("weight_kg" >= (0)::numeric))
);


ALTER TABLE "public"."gym_sets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meal_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meal_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dish_id" "uuid",
    "prepared_batch_id" "uuid",
    "cooked_portion_g" numeric(10,2),
    CONSTRAINT "meal_entries_cooked_portion_check" CHECK ((("cooked_portion_g" IS NULL) OR ("cooked_portion_g" > (0)::numeric))),
    CONSTRAINT "meal_entries_name_check" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "meal_entries_prepared_portion_check" CHECK ((("prepared_batch_id" IS NULL) OR ("cooked_portion_g" IS NOT NULL)))
);


ALTER TABLE "public"."meal_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meal_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "meal_id" "uuid" NOT NULL,
    "food_name" "text" NOT NULL,
    "quantity_g" double precision NOT NULL,
    "calories" double precision NOT NULL,
    "protein_g" double precision NOT NULL,
    "carbs_g" double precision NOT NULL,
    "fat_g" double precision NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "off_food_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "entry_id" "uuid" NOT NULL,
    "unit" "text" DEFAULT 'g'::"text" NOT NULL,
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "food_key" "text",
    "pantry_item_id" "uuid",
    "pantry_quantity_used" double precision DEFAULT 0 NOT NULL,
    "fiber_g" double precision,
    "sugars_g" double precision,
    "salt_g" double precision,
    "dish_item_id" "uuid",
    "piece_count" double precision,
    "piece_size" "text",
    "is_customization" boolean DEFAULT false NOT NULL,
    "alcohol_abv" numeric(5,2),
    "position" integer NOT NULL,
    CONSTRAINT "meal_items_alcohol_abv_check" CHECK ((("alcohol_abv" >= (0)::numeric) AND ("alcohol_abv" <= (100)::numeric))),
    CONSTRAINT "meal_items_category_check" CHECK (("category" = ANY (ARRAY['grain'::"text", 'bakery'::"text", 'legume'::"text", 'vegetable'::"text", 'fruit'::"text", 'nuts_seeds'::"text", 'meat'::"text", 'fish'::"text", 'dairy'::"text", 'egg'::"text", 'plant_protein'::"text", 'spread'::"text", 'fat'::"text", 'sauce'::"text", 'condiment'::"text", 'seasoning'::"text", 'sweet'::"text", 'snack'::"text", 'prepared'::"text", 'supplement'::"text", 'alcohol'::"text", 'beverage'::"text", 'other'::"text"]))),
    CONSTRAINT "meal_items_fiber_g_check" CHECK ((("fiber_g" IS NULL) OR ("fiber_g" >= (0)::double precision))),
    CONSTRAINT "meal_items_pantry_quantity_used_check" CHECK (("pantry_quantity_used" >= (0)::double precision)),
    CONSTRAINT "meal_items_piece_count_check" CHECK ((("piece_count" IS NULL) OR ("piece_count" > (0)::double precision))),
    CONSTRAINT "meal_items_piece_pair" CHECK ((("piece_count" IS NULL) = ("piece_size" IS NULL))),
    CONSTRAINT "meal_items_piece_size_check" CHECK (("piece_size" = ANY (ARRAY['small'::"text", 'medium'::"text", 'large'::"text"]))),
    CONSTRAINT "meal_items_position_nonnegative" CHECK (("position" >= 0)),
    CONSTRAINT "meal_items_salt_g_check" CHECK ((("salt_g" IS NULL) OR ("salt_g" >= (0)::double precision))),
    CONSTRAINT "meal_items_sugars_g_check" CHECK ((("sugars_g" IS NULL) OR ("sugars_g" >= (0)::double precision))),
    CONSTRAINT "meal_items_unit_check" CHECK (("unit" = ANY (ARRAY['g'::"text", 'ml'::"text"])))
);


ALTER TABLE "public"."meal_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."meals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "meal_type" "text" NOT NULL,
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "meals_meal_type_check" CHECK (("meal_type" = ANY (ARRAY['breakfast'::"text", 'lunch'::"text", 'dinner'::"text", 'snack'::"text", 'drinks'::"text"])))
);


ALTER TABLE "public"."meals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "portfolio_id" integer NOT NULL,
    "symbol" character varying NOT NULL,
    "isin" character varying,
    "name" character varying,
    "exchange" character varying,
    "currency" character varying DEFAULT 'EUR'::character varying,
    "quantity" numeric(20,8) NOT NULL,
    "price" numeric(12,4) NOT NULL,
    "commission" numeric(12,4) DEFAULT 0,
    "instrument_type" character varying,
    "order_type" character varying NOT NULL,
    "date" "date" NOT NULL,
    "ter" numeric(8,4),
    "transaction_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "description" "text"
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."orders_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."orders_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."orders_id_seq" OWNED BY "public"."orders"."id";



CREATE TABLE IF NOT EXISTS "public"."pantry_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "quantity" double precision DEFAULT 1 NOT NULL,
    "unit" "text" DEFAULT 'g'::"text" NOT NULL,
    "calories_100g" double precision NOT NULL,
    "protein_100g" double precision NOT NULL,
    "carbs_100g" double precision NOT NULL,
    "fat_100g" double precision NOT NULL,
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "off_food_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "food_key" "text",
    "off_data" "jsonb",
    "fiber_100g" double precision,
    "sugars_100g" double precision,
    "saturated_fat_100g" double precision,
    "unsaturated_fat_100g" double precision,
    "salt_100g" double precision,
    "nutrition_score" double precision,
    "nutrition_grade" "text",
    "nova_group" integer,
    "ecoscore_grade" "text",
    "barcode" "text",
    "archived_at" timestamp with time zone,
    "nutrition_unit" "text" DEFAULT 'g'::"text" NOT NULL,
    "alcohol_abv" numeric(5,2),
    CONSTRAINT "pantry_items_alcohol_abv_check" CHECK ((("alcohol_abv" >= (0)::numeric) AND ("alcohol_abv" <= (100)::numeric))),
    CONSTRAINT "pantry_items_barcode_check" CHECK ((("barcode" IS NULL) OR (("barcode" ~ '^[0-9]+$'::"text") AND ("length"("barcode") = ANY (ARRAY[8, 12, 13, 14]))))),
    CONSTRAINT "pantry_items_category_check" CHECK (("category" = ANY (ARRAY['grain'::"text", 'bakery'::"text", 'legume'::"text", 'vegetable'::"text", 'fruit'::"text", 'nuts_seeds'::"text", 'meat'::"text", 'fish'::"text", 'dairy'::"text", 'egg'::"text", 'plant_protein'::"text", 'spread'::"text", 'fat'::"text", 'sauce'::"text", 'condiment'::"text", 'seasoning'::"text", 'sweet'::"text", 'snack'::"text", 'prepared'::"text", 'supplement'::"text", 'alcohol'::"text", 'beverage'::"text", 'other'::"text"]))),
    CONSTRAINT "pantry_items_nutrition_unit_check" CHECK (("nutrition_unit" = ANY (ARRAY['g'::"text", 'ml'::"text"]))),
    CONSTRAINT "pantry_items_quantity_check" CHECK (("quantity" >= (0)::double precision)),
    CONSTRAINT "pantry_items_unit_check" CHECK (("unit" = ANY (ARRAY['g'::"text", 'ml'::"text", 'pz'::"text"])))
);


ALTER TABLE "public"."pantry_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pantry_items"."off_data" IS 'Complete Open Food Facts product payload captured at import time';



COMMENT ON COLUMN "public"."pantry_items"."unsaturated_fat_100g" IS 'Total fat minus saturated fat when not supplied by Open Food Facts';



COMMENT ON COLUMN "public"."pantry_items"."nutrition_score" IS 'Open Food Facts Nutri-Score numeric score';



COMMENT ON COLUMN "public"."pantry_items"."nutrition_grade" IS 'Open Food Facts Nutri-Score grade';



CREATE TABLE IF NOT EXISTS "public"."portfolios" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "initial_capital" double precision DEFAULT 0,
    "reference_currency" "text" DEFAULT 'EUR'::"text",
    "risk_free_source" "text" DEFAULT 'auto'::"text",
    "market_benchmark" "text" DEFAULT 'auto'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "profile_id" "uuid",
    "icon" "text",
    "color" "text",
    "history_mode" "text" DEFAULT 'full_orders'::"text" NOT NULL,
    CONSTRAINT "portfolios_history_mode_check" CHECK (("history_mode" = ANY (ARRAY['full_orders'::"text", 'positions_only'::"text"])))
);


ALTER TABLE "public"."portfolios" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."portfolios_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."portfolios_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."portfolios_id_seq" OWNED BY "public"."portfolios"."id";



CREATE TABLE IF NOT EXISTS "public"."prepared_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "snapshot_dish_id" "uuid" NOT NULL,
    "source_dish_id" "uuid",
    "total_cooked_g" numeric(10,2) NOT NULL,
    "remaining_g" numeric(10,2) NOT NULL,
    "closed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prepared_batches_check" CHECK ((("remaining_g" >= (0)::numeric) AND ("remaining_g" <= "total_cooked_g"))),
    CONSTRAINT "prepared_batches_total_cooked_g_check" CHECK (("total_cooked_g" > (0)::numeric))
);


ALTER TABLE "public"."prepared_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_members" (
    "profile_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "email" "text",
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profile_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'editor'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."profile_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_share_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "invited_email" "text" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    CONSTRAINT "profile_share_invitations_role_check" CHECK (("role" = ANY (ARRAY['editor'::"text", 'viewer'::"text"]))),
    CONSTRAINT "profile_share_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."profile_share_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "name" "text" DEFAULT 'Principale'::"text" NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recurring_transactions" (
    "id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "account_id" integer NOT NULL,
    "type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "subcategory" "text",
    "amount" numeric(10,2) NOT NULL,
    "description" "text",
    "frequency" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "next_due_date" "date" NOT NULL,
    "ticker" "text",
    "quantity" numeric,
    "price" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "profile_id" "uuid",
    "portfolio_id" bigint,
    "isin" "text",
    "instrument_name" "text",
    "exchange" "text",
    "instrument_type" "text",
    "order_type" "text" DEFAULT 'buy'::"text",
    "currency" "text" DEFAULT 'EUR'::"text",
    CONSTRAINT "recurring_transactions_frequency_check" CHECK (("frequency" = ANY (ARRAY['weekly'::"text", 'monthly'::"text", 'yearly'::"text"]))),
    CONSTRAINT "recurring_transactions_type_check" CHECK (("type" = ANY (ARRAY['expense'::"text", 'income'::"text", 'investment'::"text", 'transfer'::"text"])))
);


ALTER TABLE "public"."recurring_transactions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."recurring_transactions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."recurring_transactions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."recurring_transactions_id_seq" OWNED BY "public"."recurring_transactions"."id";



CREATE TABLE IF NOT EXISTS "public"."stock_symbol_cache" (
    "symbol" "text" NOT NULL,
    "name" "text",
    "exchange" "text",
    "currency" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."stock_symbol_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subcategories" (
    "id" bigint NOT NULL,
    "category_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."subcategories" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."subcategories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."subcategories_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."subcategories_id_seq" OWNED BY "public"."subcategories"."id";



CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "account_id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "subcategory" "text",
    "amount" double precision NOT NULL,
    "description" "text",
    "date" "date" NOT NULL,
    "ticker" "text",
    "quantity" double precision,
    "price" double precision,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "recurring_id" integer,
    "profile_id" "uuid",
    CONSTRAINT "transactions_type_check" CHECK (("type" = ANY (ARRAY['expense'::"text", 'income'::"text", 'investment'::"text", 'transfer'::"text"])))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."transactions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."transactions_id_seq" OWNED BY "public"."transactions"."id";



CREATE TABLE IF NOT EXISTS "public"."transfers" (
    "id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "from_account_id" integer NOT NULL,
    "to_account_id" integer NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text",
    "date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "profile_id" "uuid",
    CONSTRAINT "transfers_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."transfers" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."transfers_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."transfers_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."transfers_id_seq" OWNED BY "public"."transfers"."id";



CREATE TABLE IF NOT EXISTS "public"."user_goals" (
    "user_id" "uuid" NOT NULL,
    "calorie_target" integer NOT NULL,
    "protein_g" double precision NOT NULL,
    "carbs_g" double precision NOT NULL,
    "fat_g" double precision NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "calculation_weight_kg" double precision,
    CONSTRAINT "user_goals_calculation_weight_check" CHECK ((("calculation_weight_kg" IS NULL) OR (("calculation_weight_kg" >= (20)::double precision) AND ("calculation_weight_kg" <= (400)::double precision))))
);


ALTER TABLE "public"."user_goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_health_profiles" (
    "user_id" "uuid" NOT NULL,
    "age" integer NOT NULL,
    "sex" "text" NOT NULL,
    "height_cm" double precision NOT NULL,
    "weight_kg" double precision NOT NULL,
    "activity_level" "text" NOT NULL,
    "objective" "text" NOT NULL,
    "target_weight_kg" double precision,
    "target_date" "date",
    "body_fat_pct" double precision,
    "bmr_override" double precision,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "does_resistance_training" boolean DEFAULT false NOT NULL,
    CONSTRAINT "user_health_profiles_activity_level_check" CHECK (("activity_level" = ANY (ARRAY['sedentary'::"text", 'light'::"text", 'moderate'::"text", 'active'::"text", 'very_active'::"text"]))),
    CONSTRAINT "user_health_profiles_objective_check" CHECK (("objective" = ANY (ARRAY['lose_weight'::"text", 'gain_muscle'::"text", 'maintain'::"text", 'recomposition'::"text"]))),
    CONSTRAINT "user_health_profiles_sex_check" CHECK (("sex" = ANY (ARRAY['male'::"text", 'female'::"text"])))
);


ALTER TABLE "public"."user_health_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weight_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "weight_kg" double precision NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."weight_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "activity" "text" NOT NULL,
    "duration_min" integer NOT NULL,
    "calories_burned" double precision NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."workouts" OWNER TO "postgres";


ALTER TABLE ONLY "public"."accounts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."accounts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."categories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."orders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."orders_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."portfolios" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."portfolios_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."recurring_transactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."recurring_transactions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subcategories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subcategories_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."transactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."transactions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."transfers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."transfers_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."barcode_products"
    ADD CONSTRAINT "barcode_products_pkey" PRIMARY KEY ("barcode");



ALTER TABLE ONLY "public"."bond_metadata_cache"
    ADD CONSTRAINT "bond_metadata_cache_pkey" PRIMARY KEY ("isin");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."dish_items"
    ADD CONSTRAINT "dish_items_calories_check_v2" CHECK (("calories" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."dish_items"
    ADD CONSTRAINT "dish_items_carbs_check_v2" CHECK (("carbs_g" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."dish_items"
    ADD CONSTRAINT "dish_items_fat_check_v2" CHECK (("fat_g" >= (0)::double precision)) NOT VALID;



ALTER TABLE ONLY "public"."dish_items"
    ADD CONSTRAINT "dish_items_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."dish_items"
    ADD CONSTRAINT "dish_items_protein_check_v2" CHECK (("protein_g" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."dish_items"
    ADD CONSTRAINT "dish_items_quantity_check_v2" CHECK (("quantity_g" > (0)::double precision)) NOT VALID;



ALTER TABLE "public"."dishes"
    ADD CONSTRAINT "dishes_name_check_v2" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)) NOT VALID;



ALTER TABLE ONLY "public"."dishes"
    ADD CONSTRAINT "dishes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."etf_ucits_cache"
    ADD CONSTRAINT "etf_ucits_cache_pkey" PRIMARY KEY ("isin", "ticker", "exchange");



ALTER TABLE ONLY "public"."gym_plan_exercises"
    ADD CONSTRAINT "gym_plan_exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gym_plan_exercises"
    ADD CONSTRAINT "gym_plan_exercises_plan_id_position_key" UNIQUE ("plan_id", "position");



ALTER TABLE ONLY "public"."gym_plans"
    ADD CONSTRAINT "gym_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gym_plans"
    ADD CONSTRAINT "gym_plans_user_position_unique" UNIQUE ("user_id", "position") DEFERRABLE;



ALTER TABLE ONLY "public"."gym_sessions"
    ADD CONSTRAINT "gym_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gym_sets"
    ADD CONSTRAINT "gym_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gym_sets"
    ADD CONSTRAINT "gym_sets_session_id_exercise_position_set_number_key" UNIQUE ("session_id", "exercise_position", "set_number");



ALTER TABLE ONLY "public"."meal_entries"
    ADD CONSTRAINT "meal_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."meal_items"
    ADD CONSTRAINT "meal_items_calories_check_v2" CHECK (("calories" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."meal_items"
    ADD CONSTRAINT "meal_items_carbs_check_v2" CHECK (("carbs_g" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."meal_items"
    ADD CONSTRAINT "meal_items_fat_check_v2" CHECK (("fat_g" >= (0)::double precision)) NOT VALID;



ALTER TABLE ONLY "public"."meal_items"
    ADD CONSTRAINT "meal_items_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."meal_items"
    ADD CONSTRAINT "meal_items_protein_check_v2" CHECK (("protein_g" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."meal_items"
    ADD CONSTRAINT "meal_items_quantity_check_v2" CHECK (("quantity_g" > (0)::double precision)) NOT VALID;



ALTER TABLE ONLY "public"."meals"
    ADD CONSTRAINT "meals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."pantry_items"
    ADD CONSTRAINT "pantry_items_calories_check_v2" CHECK (("calories_100g" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."pantry_items"
    ADD CONSTRAINT "pantry_items_carbs_check_v2" CHECK (("carbs_100g" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."pantry_items"
    ADD CONSTRAINT "pantry_items_fat_check_v2" CHECK (("fat_100g" >= (0)::double precision)) NOT VALID;



ALTER TABLE ONLY "public"."pantry_items"
    ADD CONSTRAINT "pantry_items_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."pantry_items"
    ADD CONSTRAINT "pantry_items_protein_check_v2" CHECK (("protein_100g" >= (0)::double precision)) NOT VALID;



ALTER TABLE ONLY "public"."portfolios"
    ADD CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prepared_batches"
    ADD CONSTRAINT "prepared_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prepared_batches"
    ADD CONSTRAINT "prepared_batches_snapshot_dish_id_key" UNIQUE ("snapshot_dish_id");



ALTER TABLE ONLY "public"."profile_members"
    ADD CONSTRAINT "profile_members_pkey" PRIMARY KEY ("profile_id", "user_id");



ALTER TABLE ONLY "public"."profile_share_invitations"
    ADD CONSTRAINT "profile_share_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recurring_transactions"
    ADD CONSTRAINT "recurring_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_symbol_cache"
    ADD CONSTRAINT "stock_symbol_cache_pkey" PRIMARY KEY ("symbol");



ALTER TABLE ONLY "public"."subcategories"
    ADD CONSTRAINT "subcategories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."user_goals"
    ADD CONSTRAINT "user_goals_calories_check_v2" CHECK (("calorie_target" > 0)) NOT VALID;



ALTER TABLE "public"."user_goals"
    ADD CONSTRAINT "user_goals_carbs_check_v2" CHECK (("carbs_g" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."user_goals"
    ADD CONSTRAINT "user_goals_fat_check_v2" CHECK (("fat_g" >= (0)::double precision)) NOT VALID;



ALTER TABLE ONLY "public"."user_goals"
    ADD CONSTRAINT "user_goals_pkey" PRIMARY KEY ("user_id");



ALTER TABLE "public"."user_goals"
    ADD CONSTRAINT "user_goals_protein_check_v2" CHECK (("protein_g" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."user_health_profiles"
    ADD CONSTRAINT "user_health_profiles_age_check_v2" CHECK ((("age" >= 10) AND ("age" <= 120))) NOT VALID;



ALTER TABLE "public"."user_health_profiles"
    ADD CONSTRAINT "user_health_profiles_bmr_check_v2" CHECK (("bmr_override" > (0)::double precision)) NOT VALID;



ALTER TABLE "public"."user_health_profiles"
    ADD CONSTRAINT "user_health_profiles_body_fat_check_v2" CHECK ((("body_fat_pct" >= (1)::double precision) AND ("body_fat_pct" <= (75)::double precision))) NOT VALID;



ALTER TABLE "public"."user_health_profiles"
    ADD CONSTRAINT "user_health_profiles_height_check_v2" CHECK ((("height_cm" >= (100)::double precision) AND ("height_cm" <= (250)::double precision))) NOT VALID;



ALTER TABLE ONLY "public"."user_health_profiles"
    ADD CONSTRAINT "user_health_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE "public"."user_health_profiles"
    ADD CONSTRAINT "user_health_profiles_target_weight_check_v2" CHECK ((("target_weight_kg" >= (20)::double precision) AND ("target_weight_kg" <= (400)::double precision))) NOT VALID;



ALTER TABLE "public"."user_health_profiles"
    ADD CONSTRAINT "user_health_profiles_weight_check_v2" CHECK ((("weight_kg" >= (20)::double precision) AND ("weight_kg" <= (400)::double precision))) NOT VALID;



ALTER TABLE ONLY "public"."weight_logs"
    ADD CONSTRAINT "weight_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weight_logs"
    ADD CONSTRAINT "weight_logs_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE "public"."weight_logs"
    ADD CONSTRAINT "weight_logs_weight_check_v2" CHECK ((("weight_kg" >= (20)::double precision) AND ("weight_kg" <= (400)::double precision))) NOT VALID;



ALTER TABLE "public"."workouts"
    ADD CONSTRAINT "workouts_calories_check_v2" CHECK (("calories_burned" >= (0)::double precision)) NOT VALID;



ALTER TABLE "public"."workouts"
    ADD CONSTRAINT "workouts_duration_check_v2" CHECK (("duration_min" > 0)) NOT VALID;



ALTER TABLE ONLY "public"."workouts"
    ADD CONSTRAINT "workouts_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "dish_items_dish_position_idx" ON "public"."dish_items" USING "btree" ("dish_id", "position");



CREATE INDEX "dish_items_food_key_idx" ON "public"."dish_items" USING "btree" ("food_key") WHERE ("food_key" IS NOT NULL);



CREATE INDEX "dish_items_pantry_item_id_idx" ON "public"."dish_items" USING "btree" ("pantry_item_id") WHERE ("pantry_item_id" IS NOT NULL);



CREATE INDEX "dishes_user_id_idx" ON "public"."dishes" USING "btree" ("user_id");



CREATE INDEX "dishes_user_id_regular_idx" ON "public"."dishes" USING "btree" ("user_id", "name") WHERE (NOT "is_preparation");



CREATE INDEX "gym_plans_user_idx" ON "public"."gym_plans" USING "btree" ("user_id", "created_at");



CREATE UNIQUE INDEX "gym_sessions_one_active_idx" ON "public"."gym_sessions" USING "btree" ("user_id") WHERE ("completed_at" IS NULL);



CREATE INDEX "gym_sessions_user_date_idx" ON "public"."gym_sessions" USING "btree" ("user_id", "date" DESC);



CREATE INDEX "gym_sets_session_idx" ON "public"."gym_sets" USING "btree" ("session_id", "exercise_position", "set_number");



CREATE INDEX "idx_recurring_transactions_portfolio_id" ON "public"."recurring_transactions" USING "btree" ("portfolio_id");



CREATE INDEX "meal_entries_dish_id_idx" ON "public"."meal_entries" USING "btree" ("dish_id") WHERE ("dish_id" IS NOT NULL);



CREATE INDEX "meal_entries_meal_id_created_at_idx" ON "public"."meal_entries" USING "btree" ("meal_id", "created_at");



CREATE INDEX "meal_entries_prepared_batch_idx" ON "public"."meal_entries" USING "btree" ("prepared_batch_id") WHERE ("prepared_batch_id" IS NOT NULL);



CREATE INDEX "meal_items_dish_item_id_idx" ON "public"."meal_items" USING "btree" ("dish_item_id") WHERE ("dish_item_id" IS NOT NULL);



CREATE INDEX "meal_items_entry_id_created_at_idx" ON "public"."meal_items" USING "btree" ("entry_id", "created_at");



CREATE UNIQUE INDEX "meal_items_entry_position_idx" ON "public"."meal_items" USING "btree" ("entry_id", "position");



CREATE INDEX "meal_items_food_key_idx" ON "public"."meal_items" USING "btree" ("food_key") WHERE ("food_key" IS NOT NULL);



CREATE INDEX "meal_items_pantry_item_id_idx" ON "public"."meal_items" USING "btree" ("pantry_item_id") WHERE ("pantry_item_id" IS NOT NULL);



CREATE UNIQUE INDEX "meals_user_date_type_key" ON "public"."meals" USING "btree" ("user_id", "date", "meal_type");



CREATE INDEX "pantry_items_barcode_idx" ON "public"."pantry_items" USING "btree" ("user_id", "barcode") WHERE ("barcode" IS NOT NULL);



CREATE INDEX "pantry_items_food_key_idx" ON "public"."pantry_items" USING "btree" ("food_key") WHERE ("food_key" IS NOT NULL);



CREATE INDEX "pantry_items_user_id_idx" ON "public"."pantry_items" USING "btree" ("user_id");



CREATE INDEX "prepared_batches_active_idx" ON "public"."prepared_batches" USING "btree" ("user_id", "created_at" DESC) WHERE (("closed_at" IS NULL) AND ("remaining_g" > (0)::numeric));



CREATE INDEX "profile_members_user_id_idx" ON "public"."profile_members" USING "btree" ("user_id");



CREATE INDEX "profile_share_invitations_email_idx" ON "public"."profile_share_invitations" USING "btree" ("invited_email");



CREATE INDEX "profile_share_invitations_status_idx" ON "public"."profile_share_invitations" USING "btree" ("status");



CREATE INDEX "workouts_user_id_date_idx" ON "public"."workouts" USING "btree" ("user_id", "date");



CREATE OR REPLACE TRIGGER "adjust_prepared_batch_remaining_after_delete" AFTER DELETE ON "public"."meal_entries" FOR EACH ROW WHEN (("old"."prepared_batch_id" IS NOT NULL)) EXECUTE FUNCTION "public"."adjust_prepared_batch_remaining"();



CREATE OR REPLACE TRIGGER "adjust_prepared_batch_remaining_after_insert" AFTER INSERT ON "public"."meal_entries" FOR EACH ROW WHEN (("new"."prepared_batch_id" IS NOT NULL)) EXECUTE FUNCTION "public"."adjust_prepared_batch_remaining"();



CREATE OR REPLACE TRIGGER "adjust_prepared_batch_remaining_after_update" AFTER UPDATE OF "prepared_batch_id", "cooked_portion_g" ON "public"."meal_entries" FOR EACH ROW WHEN ((("old"."prepared_batch_id" IS DISTINCT FROM "new"."prepared_batch_id") OR ("old"."cooked_portion_g" IS DISTINCT FROM "new"."cooked_portion_g"))) EXECUTE FUNCTION "public"."adjust_prepared_batch_remaining"();



CREATE OR REPLACE TRIGGER "assign_gym_plan_position_before_insert" BEFORE INSERT ON "public"."gym_plans" FOR EACH ROW EXECUTE FUNCTION "public"."assign_gym_plan_position"();



CREATE OR REPLACE TRIGGER "assign_meal_item_position_before_insert" BEFORE INSERT ON "public"."meal_items" FOR EACH ROW EXECUTE FUNCTION "public"."assign_meal_item_position"();



CREATE OR REPLACE TRIGGER "dish_item_nutrition_from_pantry" BEFORE INSERT OR UPDATE OF "quantity_g", "pantry_item_id", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "salt_g", "alcohol_abv" ON "public"."dish_items" FOR EACH ROW EXECUTE FUNCTION "public"."apply_pantry_nutrition_to_dish_item"();



CREATE OR REPLACE TRIGGER "dish_item_unit_from_ingredient" BEFORE INSERT OR UPDATE OF "pantry_item_id" ON "public"."dish_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_dish_item_unit_from_ingredient"();



CREATE OR REPLACE TRIGGER "meal_item_nutrition_from_source" BEFORE INSERT OR UPDATE OF "quantity_g", "dish_item_id", "pantry_item_id", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "salt_g", "alcohol_abv" ON "public"."meal_items" FOR EACH ROW EXECUTE FUNCTION "public"."apply_source_nutrition_to_meal_item"();



CREATE OR REPLACE TRIGGER "sync_pantry_nutrition_after_update" AFTER UPDATE OF "calories_100g", "protein_100g", "carbs_100g", "fat_100g", "fiber_100g", "sugars_100g", "salt_100g", "alcohol_abv" ON "public"."pantry_items" FOR EACH ROW WHEN ((("old"."calories_100g" IS DISTINCT FROM "new"."calories_100g") OR ("old"."protein_100g" IS DISTINCT FROM "new"."protein_100g") OR ("old"."carbs_100g" IS DISTINCT FROM "new"."carbs_100g") OR ("old"."fat_100g" IS DISTINCT FROM "new"."fat_100g") OR ("old"."fiber_100g" IS DISTINCT FROM "new"."fiber_100g") OR ("old"."sugars_100g" IS DISTINCT FROM "new"."sugars_100g") OR ("old"."salt_100g" IS DISTINCT FROM "new"."salt_100g") OR ("old"."alcohol_abv" IS DISTINCT FROM "new"."alcohol_abv"))) EXECUTE FUNCTION "public"."sync_pantry_nutrition"();



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dish_items"
    ADD CONSTRAINT "dish_items_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "public"."dishes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dish_items"
    ADD CONSTRAINT "dish_items_pantry_item_id_fkey" FOREIGN KEY ("pantry_item_id") REFERENCES "public"."pantry_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dishes"
    ADD CONSTRAINT "dishes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gym_plan_exercises"
    ADD CONSTRAINT "gym_plan_exercises_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."gym_plans"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gym_plans"
    ADD CONSTRAINT "gym_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gym_sessions"
    ADD CONSTRAINT "gym_sessions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."gym_plans"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."gym_sessions"
    ADD CONSTRAINT "gym_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gym_sets"
    ADD CONSTRAINT "gym_sets_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."gym_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meal_entries"
    ADD CONSTRAINT "meal_entries_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "public"."dishes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."meal_entries"
    ADD CONSTRAINT "meal_entries_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meal_entries"
    ADD CONSTRAINT "meal_entries_prepared_batch_id_fkey" FOREIGN KEY ("prepared_batch_id") REFERENCES "public"."prepared_batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."meal_items"
    ADD CONSTRAINT "meal_items_dish_item_id_fkey" FOREIGN KEY ("dish_item_id") REFERENCES "public"."dish_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."meal_items"
    ADD CONSTRAINT "meal_items_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "public"."meal_entries"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meal_items"
    ADD CONSTRAINT "meal_items_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."meal_items"
    ADD CONSTRAINT "meal_items_pantry_item_id_fkey" FOREIGN KEY ("pantry_item_id") REFERENCES "public"."pantry_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."meals"
    ADD CONSTRAINT "meals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pantry_items"
    ADD CONSTRAINT "pantry_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolios"
    ADD CONSTRAINT "portfolios_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolios"
    ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prepared_batches"
    ADD CONSTRAINT "prepared_batches_snapshot_dish_id_fkey" FOREIGN KEY ("snapshot_dish_id") REFERENCES "public"."dishes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prepared_batches"
    ADD CONSTRAINT "prepared_batches_source_dish_id_fkey" FOREIGN KEY ("source_dish_id") REFERENCES "public"."dishes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prepared_batches"
    ADD CONSTRAINT "prepared_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_members"
    ADD CONSTRAINT "profile_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_members"
    ADD CONSTRAINT "profile_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_share_invitations"
    ADD CONSTRAINT "profile_share_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."profile_share_invitations"
    ADD CONSTRAINT "profile_share_invitations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_transactions"
    ADD CONSTRAINT "recurring_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_transactions"
    ADD CONSTRAINT "recurring_transactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_transactions"
    ADD CONSTRAINT "recurring_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subcategories"
    ADD CONSTRAINT "subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_recurring_id_fkey" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_goals"
    ADD CONSTRAINT "user_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_health_profiles"
    ADD CONSTRAINT "user_health_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weight_logs"
    ADD CONSTRAINT "weight_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workouts"
    ADD CONSTRAINT "workouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Public read bond metadata" ON "public"."bond_metadata_cache" FOR SELECT USING (true);



ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "authenticated users read barcode_products" ON "public"."barcode_products" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."barcode_products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bond_metadata_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cancel_own_invitation" ON "public"."profile_share_invitations" FOR UPDATE USING ((("invited_by" = "auth"."uid"()) AND ("status" = 'pending'::"text")));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dish_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dishes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."etf_ucits_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gym_plan_exercises" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gym_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gym_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gym_sets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meal_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meal_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "members_all" ON "public"."accounts" USING ("public"."is_profile_member"("profile_id", "auth"."uid"())) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profile_members"
  WHERE (("profile_members"."profile_id" = "accounts"."profile_id") AND ("profile_members"."user_id" = "auth"."uid"()) AND ("profile_members"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))));



CREATE POLICY "members_all" ON "public"."categories" USING ("public"."is_profile_member"("profile_id", "auth"."uid"())) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profile_members"
  WHERE (("profile_members"."profile_id" = "categories"."profile_id") AND ("profile_members"."user_id" = "auth"."uid"()) AND ("profile_members"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))));



CREATE POLICY "members_all" ON "public"."orders" USING (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE "public"."is_profile_member"("portfolios"."profile_id", "auth"."uid"())))) WITH CHECK (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE (EXISTS ( SELECT 1
           FROM "public"."profile_members"
          WHERE (("profile_members"."profile_id" = "portfolios"."profile_id") AND ("profile_members"."user_id" = "auth"."uid"()) AND ("profile_members"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))))));



CREATE POLICY "members_all" ON "public"."portfolios" USING ("public"."is_profile_member"("profile_id", "auth"."uid"())) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profile_members"
  WHERE (("profile_members"."profile_id" = "portfolios"."profile_id") AND ("profile_members"."user_id" = "auth"."uid"()) AND ("profile_members"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))));



CREATE POLICY "members_all" ON "public"."recurring_transactions" USING ("public"."is_profile_member"("profile_id", "auth"."uid"())) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profile_members"
  WHERE (("profile_members"."profile_id" = "recurring_transactions"."profile_id") AND ("profile_members"."user_id" = "auth"."uid"()) AND ("profile_members"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))));



CREATE POLICY "members_all" ON "public"."subcategories" USING (("category_id" IN ( SELECT "categories"."id"
   FROM "public"."categories"
  WHERE "public"."is_profile_member"("categories"."profile_id", "auth"."uid"())))) WITH CHECK (("category_id" IN ( SELECT "categories"."id"
   FROM "public"."categories"
  WHERE (EXISTS ( SELECT 1
           FROM "public"."profile_members"
          WHERE (("profile_members"."profile_id" = "categories"."profile_id") AND ("profile_members"."user_id" = "auth"."uid"()) AND ("profile_members"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))))));



CREATE POLICY "members_all" ON "public"."transactions" USING ("public"."is_profile_member"("profile_id", "auth"."uid"())) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profile_members"
  WHERE (("profile_members"."profile_id" = "transactions"."profile_id") AND ("profile_members"."user_id" = "auth"."uid"()) AND ("profile_members"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))));



CREATE POLICY "members_all" ON "public"."transfers" USING ("public"."is_profile_member"("profile_id", "auth"."uid"())) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profile_members"
  WHERE (("profile_members"."profile_id" = "transfers"."profile_id") AND ("profile_members"."user_id" = "auth"."uid"()) AND ("profile_members"."role" = ANY (ARRAY['owner'::"text", 'editor'::"text"]))))));



CREATE POLICY "members_select" ON "public"."profile_members" FOR SELECT USING ("public"."is_profile_member"("profile_id", "auth"."uid"()));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own data" ON "public"."profiles" USING (("id" = "auth"."uid"()));



CREATE POLICY "own dish_items" ON "public"."dish_items" USING ((EXISTS ( SELECT 1
   FROM "public"."dishes" "d"
  WHERE (("d"."id" = "dish_items"."dish_id") AND ("d"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."dishes" "d"
  WHERE (("d"."id" = "dish_items"."dish_id") AND ("d"."user_id" = "auth"."uid"())))));



CREATE POLICY "own dishes" ON "public"."dishes" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own goals" ON "public"."user_goals" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own gym_plan_exercises" ON "public"."gym_plan_exercises" USING ((EXISTS ( SELECT 1
   FROM "public"."gym_plans" "p"
  WHERE (("p"."id" = "gym_plan_exercises"."plan_id") AND ("p"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."gym_plans" "p"
  WHERE (("p"."id" = "gym_plan_exercises"."plan_id") AND ("p"."user_id" = "auth"."uid"())))));



CREATE POLICY "own gym_plans" ON "public"."gym_plans" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own gym_sessions" ON "public"."gym_sessions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own gym_sets" ON "public"."gym_sets" USING ((EXISTS ( SELECT 1
   FROM "public"."gym_sessions" "s"
  WHERE (("s"."id" = "gym_sets"."session_id") AND ("s"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."gym_sessions" "s"
  WHERE (("s"."id" = "gym_sets"."session_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "own meal_entries" ON "public"."meal_entries" USING ((EXISTS ( SELECT 1
   FROM "public"."meals" "m"
  WHERE (("m"."id" = "meal_entries"."meal_id") AND ("m"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."meals" "m"
  WHERE (("m"."id" = "meal_entries"."meal_id") AND ("m"."user_id" = "auth"."uid"())))));



CREATE POLICY "own meal_items" ON "public"."meal_items" USING ((EXISTS ( SELECT 1
   FROM ("public"."meal_entries" "e"
     JOIN "public"."meals" "m" ON (("m"."id" = "e"."meal_id")))
  WHERE (("e"."id" = "meal_items"."entry_id") AND ("e"."meal_id" = "e"."meal_id") AND ("m"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."meal_entries" "e"
     JOIN "public"."meals" "m" ON (("m"."id" = "e"."meal_id")))
  WHERE (("e"."id" = "meal_items"."entry_id") AND ("e"."meal_id" = "e"."meal_id") AND ("m"."user_id" = "auth"."uid"())))));



CREATE POLICY "own meals" ON "public"."meals" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own pantry_items" ON "public"."pantry_items" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own prepared_batches" ON "public"."prepared_batches" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own profile" ON "public"."user_health_profiles" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own weight_logs" ON "public"."weight_logs" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own workouts" ON "public"."workouts" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner_insert_invitation" ON "public"."profile_share_invitations" FOR INSERT WITH CHECK ("public"."is_profile_owner"("profile_id", "auth"."uid"()));



CREATE POLICY "owner_manage" ON "public"."profile_members" USING ("public"."is_profile_owner"("profile_id", "auth"."uid"()));



ALTER TABLE "public"."pantry_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."portfolios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prepared_batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_share_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_delete" ON "public"."profiles" FOR DELETE USING ((("user_id" = "auth"."uid"()) AND ("id" <> "user_id")));



CREATE POLICY "profiles_insert" ON "public"."profiles" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_profile_member"("id", "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."profile_share_invitations"
  WHERE (("profile_share_invitations"."profile_id" = "profiles"."id") AND ("profile_share_invitations"."invited_email" = "auth"."email"()) AND ("profile_share_invitations"."status" = 'pending'::"text") AND ("profile_share_invitations"."expires_at" > "now"()))))));



CREATE POLICY "profiles_update" ON "public"."profiles" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "public read" ON "public"."etf_ucits_cache" FOR SELECT USING (true);



CREATE POLICY "public read" ON "public"."stock_symbol_cache" FOR SELECT USING (true);



ALTER TABLE "public"."recurring_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "self_leave" ON "public"."profile_members" FOR DELETE USING ((("user_id" = "auth"."uid"()) AND ("role" <> 'owner'::"text")));



ALTER TABLE "public"."stock_symbol_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subcategories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transfers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_health_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "view_invitations" ON "public"."profile_share_invitations" FOR SELECT USING ((("invited_by" = "auth"."uid"()) OR ("invited_email" = "auth"."email"())));



ALTER TABLE "public"."weight_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workouts" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_profile_invitation"("p_invitation_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_profile_invitation"("p_invitation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_profile_invitation"("p_invitation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_meal_entry"("p_user_id" "uuid", "p_date" "date", "p_meal_type" "text", "p_name" "text", "p_items" "jsonb", "p_dish_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_meal_entry"("p_user_id" "uuid", "p_date" "date", "p_meal_type" "text", "p_name" "text", "p_items" "jsonb", "p_dish_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_meal_entry"("p_user_id" "uuid", "p_date" "date", "p_meal_type" "text", "p_name" "text", "p_items" "jsonb", "p_dish_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."adjust_prepared_batch_remaining"() TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_prepared_batch_remaining"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_prepared_batch_remaining"() TO "service_role";



GRANT ALL ON FUNCTION "public"."alcohol_adjusted_calories"("p_calories" numeric, "p_volume" numeric, "p_source_abv" numeric, "p_abv" numeric, "p_unit" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."alcohol_adjusted_calories"("p_calories" numeric, "p_volume" numeric, "p_source_abv" numeric, "p_abv" numeric, "p_unit" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."alcohol_adjusted_calories"("p_calories" numeric, "p_volume" numeric, "p_source_abv" numeric, "p_abv" numeric, "p_unit" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_pantry_nutrition_to_dish_item"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_pantry_nutrition_to_dish_item"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_pantry_nutrition_to_dish_item"() TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_source_nutrition_to_meal_item"() TO "anon";
GRANT ALL ON FUNCTION "public"."apply_source_nutrition_to_meal_item"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_source_nutrition_to_meal_item"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_gym_plan_position"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_gym_plan_position"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_gym_plan_position"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_meal_item_position"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_meal_item_position"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_meal_item_position"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."close_prepared_batch"("p_batch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_prepared_batch"("p_batch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."close_prepared_batch"("p_batch_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_health_onboarding"("p_profile" "jsonb", "p_goals" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_health_onboarding"("p_profile" "jsonb", "p_goals" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_health_onboarding"("p_profile" "jsonb", "p_goals" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."consume_prepared_batch"("p_batch_id" "uuid", "p_date" "date", "p_meal_type" "text", "p_grams" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."consume_prepared_batch"("p_batch_id" "uuid", "p_date" "date", "p_meal_type" "text", "p_grams" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."consume_prepared_batch"("p_batch_id" "uuid", "p_date" "date", "p_meal_type" "text", "p_grams" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_dish_with_categories"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_meal_types" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_dish_with_categories"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_meal_types" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_dish_with_categories"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_meal_types" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_dish_with_items"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_dish_with_items"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_dish_with_items"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_prepared_batch"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_source_dish_id" "uuid", "p_icon" "text", "p_total_cooked_g" numeric, "p_first_portion_g" numeric, "p_date" "date", "p_meal_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_prepared_batch"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_source_dish_id" "uuid", "p_icon" "text", "p_total_cooked_g" numeric, "p_first_portion_g" numeric, "p_date" "date", "p_meal_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_prepared_batch"("p_user_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_source_dish_id" "uuid", "p_icon" "text", "p_total_cooked_g" numeric, "p_first_portion_g" numeric, "p_date" "date", "p_meal_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_profile_invitation"("p_profile_id" "uuid", "p_email" "text", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_profile_invitation"("p_profile_id" "uuid", "p_email" "text", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_profile_invitation"("p_profile_id" "uuid", "p_email" "text", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_meal_entry"("p_entry_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_meal_entry"("p_entry_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_meal_entry"("p_entry_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_profiles"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_profiles"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_profiles"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_profile_member"("p_profile_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_profile_member"("p_profile_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_profile_member"("p_profile_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_profile_owner"("p_profile_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_profile_owner"("p_profile_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_profile_owner"("p_profile_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepared_portion_items"("p_batch_id" "uuid", "p_grams" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepared_portion_items"("p_batch_id" "uuid", "p_grams" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepared_portion_items"("p_batch_id" "uuid", "p_grams" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reorder_gym_plans"("p_plan_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_gym_plans"("p_plan_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_gym_plans"("p_plan_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."repair_own_membership"() TO "anon";
GRANT ALL ON FUNCTION "public"."repair_own_membership"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."repair_own_membership"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_gym_plan"("p_user_id" "uuid", "p_plan_id" "uuid", "p_name" "text", "p_exercises" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_gym_plan"("p_user_id" "uuid", "p_plan_id" "uuid", "p_name" "text", "p_exercises" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_gym_plan"("p_user_id" "uuid", "p_plan_id" "uuid", "p_name" "text", "p_exercises" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_dish_item_unit_from_ingredient"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_dish_item_unit_from_ingredient"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_dish_item_unit_from_ingredient"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_gym_session"("p_user_id" "uuid", "p_plan_id" "uuid", "p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_gym_session"("p_user_id" "uuid", "p_plan_id" "uuid", "p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_gym_session"("p_user_id" "uuid", "p_plan_id" "uuid", "p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_pantry_nutrition"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_pantry_nutrition"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_pantry_nutrition"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_dish_with_categories"("p_dish_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_meal_types" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_dish_with_categories"("p_dish_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_meal_types" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_dish_with_categories"("p_dish_id" "uuid", "p_name" "text", "p_items" "jsonb", "p_meal_types" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_dish_with_items"("p_dish_id" "uuid", "p_name" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_dish_with_items"("p_dish_id" "uuid", "p_name" "text", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_dish_with_items"("p_dish_id" "uuid", "p_name" "text", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_meal_entry"("p_entry_id" "uuid", "p_name" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_meal_entry"("p_entry_id" "uuid", "p_name" "text", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_meal_entry"("p_entry_id" "uuid", "p_name" "text", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_prepared_portion"("p_entry_id" "uuid", "p_grams" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_prepared_portion"("p_entry_id" "uuid", "p_grams" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_prepared_portion"("p_entry_id" "uuid", "p_grams" numeric) TO "service_role";



GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."barcode_products" TO "anon";
GRANT ALL ON TABLE "public"."barcode_products" TO "authenticated";
GRANT ALL ON TABLE "public"."barcode_products" TO "service_role";



GRANT ALL ON TABLE "public"."bond_metadata_cache" TO "anon";
GRANT ALL ON TABLE "public"."bond_metadata_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."bond_metadata_cache" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."dish_items" TO "anon";
GRANT ALL ON TABLE "public"."dish_items" TO "authenticated";
GRANT ALL ON TABLE "public"."dish_items" TO "service_role";



GRANT ALL ON TABLE "public"."dishes" TO "anon";
GRANT ALL ON TABLE "public"."dishes" TO "authenticated";
GRANT ALL ON TABLE "public"."dishes" TO "service_role";



GRANT ALL ON TABLE "public"."etf_ucits_cache" TO "anon";
GRANT ALL ON TABLE "public"."etf_ucits_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."etf_ucits_cache" TO "service_role";



GRANT ALL ON TABLE "public"."gym_plan_exercises" TO "anon";
GRANT ALL ON TABLE "public"."gym_plan_exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."gym_plan_exercises" TO "service_role";



GRANT ALL ON TABLE "public"."gym_plans" TO "anon";
GRANT ALL ON TABLE "public"."gym_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."gym_plans" TO "service_role";



GRANT ALL ON TABLE "public"."gym_sessions" TO "anon";
GRANT ALL ON TABLE "public"."gym_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."gym_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."gym_sets" TO "anon";
GRANT ALL ON TABLE "public"."gym_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."gym_sets" TO "service_role";



GRANT ALL ON TABLE "public"."meal_entries" TO "anon";
GRANT ALL ON TABLE "public"."meal_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."meal_entries" TO "service_role";



GRANT ALL ON TABLE "public"."meal_items" TO "anon";
GRANT ALL ON TABLE "public"."meal_items" TO "authenticated";
GRANT ALL ON TABLE "public"."meal_items" TO "service_role";



GRANT ALL ON TABLE "public"."meals" TO "anon";
GRANT ALL ON TABLE "public"."meals" TO "authenticated";
GRANT ALL ON TABLE "public"."meals" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pantry_items" TO "anon";
GRANT ALL ON TABLE "public"."pantry_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pantry_items" TO "service_role";



GRANT ALL ON TABLE "public"."portfolios" TO "anon";
GRANT ALL ON TABLE "public"."portfolios" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolios" TO "service_role";



GRANT ALL ON SEQUENCE "public"."portfolios_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."portfolios_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."portfolios_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."prepared_batches" TO "anon";
GRANT ALL ON TABLE "public"."prepared_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."prepared_batches" TO "service_role";



GRANT ALL ON TABLE "public"."profile_members" TO "anon";
GRANT ALL ON TABLE "public"."profile_members" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_members" TO "service_role";



GRANT ALL ON TABLE "public"."profile_share_invitations" TO "anon";
GRANT ALL ON TABLE "public"."profile_share_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_share_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."recurring_transactions" TO "anon";
GRANT ALL ON TABLE "public"."recurring_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_transactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."recurring_transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."recurring_transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recurring_transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."stock_symbol_cache" TO "anon";
GRANT ALL ON TABLE "public"."stock_symbol_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_symbol_cache" TO "service_role";



GRANT ALL ON TABLE "public"."subcategories" TO "anon";
GRANT ALL ON TABLE "public"."subcategories" TO "authenticated";
GRANT ALL ON TABLE "public"."subcategories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subcategories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subcategories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subcategories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."transfers" TO "anon";
GRANT ALL ON TABLE "public"."transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."transfers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transfers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transfers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transfers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_goals" TO "anon";
GRANT ALL ON TABLE "public"."user_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."user_goals" TO "service_role";



GRANT ALL ON TABLE "public"."user_health_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_health_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_health_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."weight_logs" TO "anon";
GRANT ALL ON TABLE "public"."weight_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."weight_logs" TO "service_role";



GRANT ALL ON TABLE "public"."workouts" TO "anon";
GRANT ALL ON TABLE "public"."workouts" TO "authenticated";
GRANT ALL ON TABLE "public"."workouts" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
