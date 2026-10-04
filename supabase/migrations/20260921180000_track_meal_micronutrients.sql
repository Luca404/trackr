-- Persist fibre, sugars and salt on reusable dishes and consumed meal items.
-- Values are nullable because local/manual foods do not always provide them;
-- unknown must remain distinct from a measured zero.

alter table public.meal_items
  add column fiber_g double precision check (fiber_g is null or fiber_g >= 0),
  add column sugars_g double precision check (sugars_g is null or sugars_g >= 0),
  add column salt_g double precision check (salt_g is null or salt_g >= 0);
alter table public.dish_items
  add column fiber_g double precision check (fiber_g is null or fiber_g >= 0),
  add column sugars_g double precision check (sugars_g is null or sugars_g >= 0),
  add column salt_g double precision check (salt_g is null or salt_g >= 0);
-- Recover values for existing rows that still point to a pantry product with
-- extended nutrition data.
update public.meal_items mi
set fiber_g = case when p.fiber_100g is null then null else p.fiber_100g * mi.quantity_g / 100 end,
    sugars_g = case when p.sugars_100g is null then null else p.sugars_100g * mi.quantity_g / 100 end,
    salt_g = case when p.salt_100g is null then null else p.salt_100g * mi.quantity_g / 100 end
from public.pantry_items p
where mi.pantry_item_id = p.id;
update public.dish_items di
set fiber_g = case when p.fiber_100g is null then null else p.fiber_100g * di.quantity_g / 100 end,
    sugars_g = case when p.sugars_100g is null then null else p.sugars_100g * di.quantity_g / 100 end,
    salt_g = case when p.salt_100g is null then null else p.salt_100g * di.quantity_g / 100 end
from public.pantry_items p
where di.pantry_item_id = p.id;
create or replace function public.add_meal_entry(
  p_user_id uuid, p_date date, p_meal_type text, p_name text, p_items jsonb
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
  v_used double precision;
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

  insert into public.meals (user_id, date, meal_type, name)
  values (p_user_id, p_date, p_meal_type, null)
  on conflict (user_id, date, meal_type) do update set name = public.meals.name
  returning * into v_meal;

  insert into public.meal_entries (meal_id, name)
  values (v_meal.id, trim(p_name))
  returning * into v_entry;

  insert into public.meal_items (
    meal_id, entry_id, food_name, quantity_g, unit, category, food_key,
    pantry_item_id, calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g,
    salt_g, source, off_food_id
  )
  select
    v_meal.id, v_entry.id, x.food_name, x.quantity_g, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories,
    x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
    coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_to_recordset(p_items) as x(
    food_name text, quantity_g double precision, unit text, category text, food_key text,
    pantry_item_id uuid, calories double precision, protein_g double precision,
    carbs_g double precision, fat_g double precision, fiber_g double precision,
    sugars_g double precision, salt_g double precision, source text, off_food_id text
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
create or replace function public.update_meal_entry(
  p_entry_id uuid, p_name text, p_items jsonb
)
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
  v_used double precision;
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
    meal_id, entry_id, food_name, quantity_g, unit, category, food_key,
    pantry_item_id, calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g,
    salt_g, source, off_food_id
  )
  select
    v_entry.meal_id, v_entry.id, x.food_name, x.quantity_g, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories,
    x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
    coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_to_recordset(p_items) as x(
    food_name text, quantity_g double precision, unit text, category text, food_key text,
    pantry_item_id uuid, calories double precision, protein_g double precision,
    carbs_g double precision, fat_g double precision, fiber_g double precision,
    sugars_g double precision, salt_g double precision, source text, off_food_id text
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
create or replace function public.create_dish_with_items(
  p_user_id uuid, p_name text, p_items jsonb
)
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
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array' using errcode = '22023';
  end if;

  insert into public.dishes (user_id, name)
  values (p_user_id, trim(p_name))
  returning * into v_dish;

  with inserted as (
    insert into public.dish_items (
      dish_id, food_name, quantity_g, category, food_key, pantry_item_id,
      calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, source,
      off_food_id
    )
    select
      v_dish.id, x.food_name, x.quantity_g, coalesce(x.category, 'other'),
      x.food_key, x.pantry_item_id, x.calories, x.protein_g, x.carbs_g,
      x.fat_g, x.fiber_g, x.sugars_g, x.salt_g, coalesce(x.source, 'manual'),
      x.off_food_id
    from jsonb_to_recordset(p_items) as x(
      food_name text, quantity_g double precision, category text, food_key text,
      pantry_item_id uuid, calories double precision, protein_g double precision,
      carbs_g double precision, fat_g double precision, fiber_g double precision,
      sugars_g double precision, salt_g double precision, source text, off_food_id text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) into v_items from inserted;

  return to_jsonb(v_dish) || jsonb_build_object('items', v_items);
end;
$$;
create or replace function public.update_dish_with_items(
  p_dish_id uuid, p_name text, p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dish public.dishes%rowtype;
  v_items jsonb;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name is required' using errcode = '22023';
  end if;
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
      dish_id, food_name, quantity_g, category, food_key, pantry_item_id,
      calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, source,
      off_food_id
    )
    select
      p_dish_id, x.food_name, x.quantity_g, coalesce(x.category, 'other'),
      x.food_key, x.pantry_item_id, x.calories, x.protein_g, x.carbs_g,
      x.fat_g, x.fiber_g, x.sugars_g, x.salt_g, coalesce(x.source, 'manual'),
      x.off_food_id
    from jsonb_to_recordset(p_items) as x(
      food_name text, quantity_g double precision, category text, food_key text,
      pantry_item_id uuid, calories double precision, protein_g double precision,
      carbs_g double precision, fat_g double precision, fiber_g double precision,
      sugars_g double precision, salt_g double precision, source text, off_food_id text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb) into v_items from inserted;

  return to_jsonb(v_dish) || jsonb_build_object('items', v_items);
end;
$$;
