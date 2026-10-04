-- Link diary entries to saved dishes so their icon follows later changes.
alter table public.meal_entries
  add column dish_id uuid references public.dishes on delete set null;
create index meal_entries_dish_id_idx on public.meal_entries (dish_id)
  where dish_id is not null;
-- Older entries have no dish reference. Link only a unique saved-dish name
-- belonging to the same user and already created when the entry was logged.
with unique_dishes as (
  select user_id, lower(trim(name)) as normalized_name, min(id::text)::uuid as dish_id,
         min(created_at) as created_at
  from public.dishes
  group by user_id, lower(trim(name))
  having count(*) = 1
)
update public.meal_entries e
set dish_id = d.dish_id
from public.meals m
join unique_dishes d on d.user_id = m.user_id
where e.meal_id = m.id
  and lower(trim(e.name)) = d.normalized_name
  and d.created_at <= e.created_at;
-- The previous RPC cannot accept the saved dish ID.
drop function public.add_meal_entry(uuid, date, text, text, jsonb);
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

  insert into public.meals (user_id, date, meal_type, name)
  values (p_user_id, p_date, p_meal_type, null)
  on conflict (user_id, date, meal_type) do update set name = public.meals.name
  returning * into v_meal;

  insert into public.meal_entries (meal_id, name, dish_id)
  values (v_meal.id, trim(p_name), p_dish_id)
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
    food_name text, quantity_g float, unit text, category text, food_key text,
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
revoke execute on function public.add_meal_entry(uuid, date, text, text, jsonb, uuid) from public, anon;
grant execute on function public.add_meal_entry(uuid, date, text, text, jsonb, uuid) to authenticated;
