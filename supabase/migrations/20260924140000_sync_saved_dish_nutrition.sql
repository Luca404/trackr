-- Keep meal portions linked to the saved ingredients that supplied them.
alter table public.meal_items
  add column dish_item_id uuid references public.dish_items on delete set null;
create index meal_items_dish_item_id_idx on public.meal_items (dish_item_id)
  where dish_item_id is not null;
-- Legacy portions have no ingredient ID. Match only names that occur once in
-- both the logged entry and its saved dish, and reject conflicting food keys.
with unique_dish_ingredients as (
  select dish_id, lower(trim(food_name)) as normalized_name,
         min(id::text)::uuid as dish_item_id, min(food_key) as food_key
  from public.dish_items
  group by dish_id, lower(trim(food_name))
  having count(*) = 1
), unique_entry_ingredients as (
  select mi.entry_id, lower(trim(mi.food_name)) as normalized_name,
         min(mi.id::text)::uuid as meal_item_id, min(mi.food_key) as food_key
  from public.meal_items mi
  join public.meal_entries e on e.id = mi.entry_id
  where e.dish_id is not null
  group by mi.entry_id, lower(trim(mi.food_name))
  having count(*) = 1
)
update public.meal_items mi
set dish_item_id = di.dish_item_id
from unique_entry_ingredients ei
join public.meal_entries e on e.id = ei.entry_id
join unique_dish_ingredients di on di.dish_id = e.dish_id
  and di.normalized_name = ei.normalized_name
where mi.id = ei.meal_item_id
  and (ei.food_key is null or di.food_key is null or ei.food_key = di.food_key);
create or replace function public.add_meal_entry(
  p_user_id uuid,
  p_date date,
  p_meal_type text,
  p_name text,
  p_items jsonb,
  p_dish_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_meal public.meals%rowtype;
  v_entry public.meal_entries%rowtype;
  v_item public.meal_items%rowtype;
  v_pantry public.pantry_items%rowtype;
  v_used float;
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
    meal_id, entry_id, dish_item_id, food_name, quantity_g, unit, category, food_key,
    pantry_item_id, calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g,
    salt_g, source, off_food_id
  )
  select
    v_meal.id, v_entry.id, x.dish_item_id, x.food_name, x.quantity_g, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories,
    x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
    coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_to_recordset(p_items) as x(
    dish_item_id uuid, food_name text, quantity_g float, unit text, category text, food_key text,
    pantry_item_id uuid, calories float, protein_g float, carbs_g float,
    fat_g float, fiber_g float, sugars_g float, salt_g float, source text,
    off_food_id text
  );

  for v_item in
    select * from public.meal_items where entry_id = v_entry.id order by created_at, id
  loop
    select p.* into v_pantry
    from public.pantry_items p
    where p.user_id = p_user_id and p.quantity > 0 and p.unit = v_item.unit
      and (
        (v_item.pantry_item_id is not null and p.id = v_item.pantry_item_id)
        or (v_item.pantry_item_id is null and (
          (v_item.food_key is not null and p.food_key is not null and p.food_key = v_item.food_key)
          or ((v_item.food_key is null or p.food_key is null) and (
            (v_item.off_food_id is not null and p.off_food_id = v_item.off_food_id)
            or lower(regexp_replace(trim(p.name), '[^[:alnum:]]+', ' ', 'g')) =
               lower(regexp_replace(trim(v_item.food_name), '[^[:alnum:]]+', ' ', 'g'))
          ))
        ))
      )
    order by case when p.id = v_item.pantry_item_id then 0
                  when p.food_key = v_item.food_key then 1
                  when p.off_food_id = v_item.off_food_id then 2 else 3 end,
             p.created_at, p.id
    limit 1 for update;

    if found then
      v_used := least(v_item.quantity_g, v_pantry.quantity);
      update public.pantry_items set quantity = quantity - v_used where id = v_pantry.id;
      update public.meal_items
      set pantry_item_id = v_pantry.id, pantry_quantity_used = v_used
      where id = v_item.id;
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(mi) order by mi.created_at, mi.id), '[]'::jsonb)
  into v_items from public.meal_items mi where mi.entry_id = v_entry.id;

  return jsonb_build_object(
    'meal', to_jsonb(v_meal),
    'entry', to_jsonb(v_entry) || jsonb_build_object('items', v_items)
  );
end;
$$;
create or replace function public.update_meal_entry(p_entry_id uuid, p_name text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_entry public.meal_entries%rowtype;
  v_user_id uuid;
  v_item public.meal_items%rowtype;
  v_pantry public.pantry_items%rowtype;
  v_used float;
  v_items jsonb;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array' using errcode = '22023';
  end if;

  update public.meal_entries e
  set name = trim(p_name)
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

  select user_id into v_user_id from public.meals where id = v_entry.meal_id;

  update public.pantry_items p
  set quantity = p.quantity + restored.quantity
  from (
    select pantry_item_id, sum(pantry_quantity_used) as quantity
    from public.meal_items
    where entry_id = p_entry_id and pantry_item_id is not null
    group by pantry_item_id
  ) restored
  where p.id = restored.pantry_item_id and p.user_id = v_user_id;

  delete from public.meal_items where entry_id = p_entry_id;

  insert into public.meal_items (
    meal_id, entry_id, dish_item_id, food_name, quantity_g, unit, category, food_key,
    pantry_item_id, calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g,
    salt_g, source, off_food_id
  )
  select
    v_entry.meal_id, v_entry.id, x.dish_item_id, x.food_name, x.quantity_g, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories,
    x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
    coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_to_recordset(p_items) as x(
    dish_item_id uuid, food_name text, quantity_g float, unit text, category text, food_key text,
    pantry_item_id uuid, calories float, protein_g float, carbs_g float,
    fat_g float, fiber_g float, sugars_g float, salt_g float, source text,
    off_food_id text
  );

  for v_item in
    select * from public.meal_items where entry_id = v_entry.id order by created_at, id
  loop
    select p.* into v_pantry
    from public.pantry_items p
    where p.user_id = v_user_id and p.quantity > 0 and p.unit = v_item.unit
      and (
        (v_item.pantry_item_id is not null and p.id = v_item.pantry_item_id)
        or (v_item.pantry_item_id is null and (
          (v_item.food_key is not null and p.food_key is not null and p.food_key = v_item.food_key)
          or ((v_item.food_key is null or p.food_key is null) and (
            (v_item.off_food_id is not null and p.off_food_id = v_item.off_food_id)
            or lower(regexp_replace(trim(p.name), '[^[:alnum:]]+', ' ', 'g')) =
               lower(regexp_replace(trim(v_item.food_name), '[^[:alnum:]]+', ' ', 'g'))
          ))
        ))
      )
    order by case when p.id = v_item.pantry_item_id then 0
                  when p.food_key = v_item.food_key then 1
                  when p.off_food_id = v_item.off_food_id then 2 else 3 end,
             p.created_at, p.id
    limit 1 for update;

    if found then
      v_used := least(v_item.quantity_g, v_pantry.quantity);
      update public.pantry_items set quantity = quantity - v_used where id = v_pantry.id;
      update public.meal_items
      set pantry_item_id = v_pantry.id, pantry_quantity_used = v_used
      where id = v_item.id;
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(mi) order by mi.created_at, mi.id), '[]'::jsonb)
  into v_items from public.meal_items mi where mi.entry_id = v_entry.id;

  return to_jsonb(v_entry) || jsonb_build_object('items', v_items);
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
        category = coalesce(x.category, 'other'), food_key = x.food_key,
        pantry_item_id = x.pantry_item_id, calories = x.calories,
        protein_g = x.protein_g, carbs_g = x.carbs_g, fat_g = x.fat_g,
        fiber_g = x.fiber_g, sugars_g = x.sugars_g, salt_g = x.salt_g,
        source = coalesce(x.source, 'manual'), off_food_id = x.off_food_id
      from jsonb_to_record(v_element.value) as x(
        food_name text, quantity_g float, category text, food_key text,
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
        dish_id, position, food_name, quantity_g, category, food_key, pantry_item_id,
        calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, source, off_food_id
      )
      select p_dish_id, (v_element.ordinality - 1)::integer, x.food_name, x.quantity_g,
        coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories,
        x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
        coalesce(x.source, 'manual'), x.off_food_id
      from jsonb_to_record(v_element.value) as x(
        food_name text, quantity_g float, category text, food_key text,
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
    salt_g = round((di.salt_g * mi.quantity_g / di.quantity_g)::numeric, 2)
  from public.dish_items di, public.meal_entries e
  where mi.dish_item_id = di.id and mi.entry_id = e.id
    and e.dish_id = p_dish_id and di.dish_id = p_dish_id;

  select coalesce(jsonb_agg(to_jsonb(di) order by di.position), '[]'::jsonb)
  into v_items from public.dish_items di where di.dish_id = p_dish_id;

  return to_jsonb(v_dish) || jsonb_build_object('items', v_items);
end;
$$;
