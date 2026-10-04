-- Store ABV as a percentage, independently of the consumed volume.
-- NULL means unrecorded; zero explicitly represents an alcohol-free drink.
-- Additive columns keep currently deployed clients compatible.
alter table public.meal_items add column alcohol_abv numeric(5,2)
  check (alcohol_abv >= 0 and alcohol_abv <= 100);
alter table public.dish_items add column alcohol_abv numeric(5,2)
  check (alcohol_abv >= 0 and alcohol_abv <= 100);
alter table public.pantry_items add column alcohol_abv numeric(5,2)
  check (alcohol_abv >= 0 and alcohol_abv <= 100);
create or replace function public.add_meal_entry(
  p_user_id uuid, p_date date, p_meal_type text, p_name text, p_items jsonb, p_dish_id uuid
)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
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
    meal_id, entry_id, dish_item_id, is_customization, food_name, quantity_g,
    piece_count, piece_size, unit, category, food_key, pantry_item_id,
    calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, alcohol_abv, source, off_food_id
  )
  select v_meal.id, v_entry.id, x.dish_item_id,
    coalesce(x.is_customization, p_dish_id is not null and x.dish_item_id is null),
    x.food_name, x.quantity_g, x.piece_count, x.piece_size, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id,
    x.calories, x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g,
    x.salt_g, x.alcohol_abv, coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_to_recordset(p_items) as x(
    dish_item_id uuid, is_customization boolean, food_name text, quantity_g float,
    piece_count float, piece_size text, unit text, category text, food_key text,
    pantry_item_id uuid, calories float, protein_g float, carbs_g float,
    fat_g float, fiber_g float, sugars_g float, salt_g float, alcohol_abv numeric, source text, off_food_id text
  );

  select coalesce(jsonb_agg(to_jsonb(mi) order by mi.created_at, mi.id), '[]'::jsonb)
  into v_items from public.meal_items mi where mi.entry_id = v_entry.id;
  return jsonb_build_object('meal', to_jsonb(v_meal),
    'entry', to_jsonb(v_entry) || jsonb_build_object('items', v_items));
end;
$$;
create or replace function public.update_meal_entry(p_entry_id uuid, p_name text, p_items jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
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
    meal_id, entry_id, dish_item_id, is_customization, food_name, quantity_g,
    piece_count, piece_size, unit, category, food_key, pantry_item_id,
    calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, alcohol_abv, source, off_food_id
  )
  select v_entry.meal_id, v_entry.id, x.dish_item_id,
    coalesce(x.is_customization, v_entry.dish_id is not null and x.dish_item_id is null),
    x.food_name, x.quantity_g, x.piece_count, x.piece_size, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id,
    x.calories, x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g,
    x.salt_g, x.alcohol_abv, coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_to_recordset(p_items) as x(
    dish_item_id uuid, is_customization boolean, food_name text, quantity_g float,
    piece_count float, piece_size text, unit text, category text, food_key text,
    pantry_item_id uuid, calories float, protein_g float, carbs_g float,
    fat_g float, fiber_g float, sugars_g float, salt_g float, alcohol_abv numeric, source text, off_food_id text
  );
  select coalesce(jsonb_agg(to_jsonb(mi) order by mi.created_at, mi.id), '[]'::jsonb)
  into v_items from public.meal_items mi where mi.entry_id = v_entry.id;
  return to_jsonb(v_entry) || jsonb_build_object('items', v_items);
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
create or replace function public.update_dish_with_items(p_dish_id uuid, p_name text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
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
create or replace function public.prepared_portion_items(p_batch_id uuid, p_grams numeric)
returns jsonb
language sql stable security invoker set search_path = public
as $$
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
-- Preserve non-alcohol energy when the logged ABV differs from its source.
create or replace function public.alcohol_adjusted_calories(
  p_calories numeric, p_volume numeric, p_source_abv numeric, p_abv numeric, p_unit text
)
returns numeric language sql immutable security invoker set search_path = public as $$
  select case when p_unit = 'ml' and p_source_abv is not null and p_abv is not null
    then round(greatest(0, p_calories - p_volume * p_source_abv / 100 * 0.789 * 7)
      + p_volume * p_abv / 100 * 0.789 * 7, 2)
    else round(p_calories) end;
$$;
create or replace function public.apply_pantry_nutrition_to_dish_item()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
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
create or replace function public.apply_source_nutrition_to_meal_item()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
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
drop trigger dish_item_nutrition_from_pantry on public.dish_items;
create trigger dish_item_nutrition_from_pantry
before insert or update of quantity_g, pantry_item_id, calories, protein_g,
  carbs_g, fat_g, fiber_g, sugars_g, salt_g, alcohol_abv on public.dish_items
for each row execute function public.apply_pantry_nutrition_to_dish_item();
drop trigger meal_item_nutrition_from_source on public.meal_items;
create trigger meal_item_nutrition_from_source
before insert or update of quantity_g, dish_item_id, pantry_item_id, calories,
  protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, alcohol_abv on public.meal_items
for each row execute function public.apply_source_nutrition_to_meal_item();
create or replace function public.sync_pantry_nutrition()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
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
drop trigger sync_pantry_nutrition_after_update on public.pantry_items;
create trigger sync_pantry_nutrition_after_update
after update of calories_100g, protein_100g, carbs_100g, fat_100g,
  fiber_100g, sugars_100g, salt_100g, alcohol_abv on public.pantry_items
for each row
when (
  old.calories_100g is distinct from new.calories_100g or
  old.protein_100g is distinct from new.protein_100g or
  old.carbs_100g is distinct from new.carbs_100g or
  old.fat_100g is distinct from new.fat_100g or
  old.fiber_100g is distinct from new.fiber_100g or
  old.sugars_100g is distinct from new.sugars_100g or
  old.salt_100g is distinct from new.salt_100g or
  old.alcohol_abv is distinct from new.alcohol_abv
)
execute function public.sync_pantry_nutrition();
