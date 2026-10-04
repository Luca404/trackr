alter table public.meal_items
  add column is_customization boolean not null default false;
-- Existing extras have no link to a saved recipe ingredient.
update public.meal_items mi
set is_customization = true
from public.meal_entries e
where e.id = mi.entry_id and e.dish_id is not null and mi.dish_item_id is null;
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
    meal_id, entry_id, dish_item_id, is_customization, food_name, quantity_g, piece_count, piece_size, unit, category, food_key,
    pantry_item_id, calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g,
    salt_g, source, off_food_id
  )
  select
    v_meal.id, v_entry.id, x.dish_item_id, coalesce(x.is_customization, p_dish_id is not null and x.dish_item_id is null), x.food_name, x.quantity_g, x.piece_count, x.piece_size, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories,
    x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
    coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_to_recordset(p_items) as x(
    dish_item_id uuid, is_customization boolean, food_name text, quantity_g float, piece_count float, piece_size text, unit text, category text, food_key text,
    pantry_item_id uuid, calories float, protein_g float, carbs_g float,
    fat_g float, fiber_g float, sugars_g float, salt_g float, source text,
    off_food_id text
  );

  for v_item in
    select * from public.meal_items where entry_id = v_entry.id order by created_at, id
  loop
    select p.* into v_pantry
    from public.pantry_items p
    where p.user_id = p_user_id and p.quantity > 0
      and (p.unit = v_item.unit or (p.unit = 'pz' and v_item.piece_count is not null))
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
      v_used := least(case when v_pantry.unit = 'pz' then v_item.piece_count else v_item.quantity_g end, v_pantry.quantity);
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
    meal_id, entry_id, dish_item_id, is_customization, food_name, quantity_g, piece_count, piece_size, unit, category, food_key,
    pantry_item_id, calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g,
    salt_g, source, off_food_id
  )
  select
    v_entry.meal_id, v_entry.id, x.dish_item_id, coalesce(x.is_customization, v_entry.dish_id is not null and x.dish_item_id is null), x.food_name, x.quantity_g, x.piece_count, x.piece_size, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories,
    x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
    coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_to_recordset(p_items) as x(
    dish_item_id uuid, is_customization boolean, food_name text, quantity_g float, piece_count float, piece_size text, unit text, category text, food_key text,
    pantry_item_id uuid, calories float, protein_g float, carbs_g float,
    fat_g float, fiber_g float, sugars_g float, salt_g float, source text,
    off_food_id text
  );

  for v_item in
    select * from public.meal_items where entry_id = v_entry.id order by created_at, id
  loop
    select p.* into v_pantry
    from public.pantry_items p
    where p.user_id = v_user_id and p.quantity > 0
      and (p.unit = v_item.unit or (p.unit = 'pz' and v_item.piece_count is not null))
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
      v_used := least(case when v_pantry.unit = 'pz' then v_item.piece_count else v_item.quantity_g end, v_pantry.quantity);
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
