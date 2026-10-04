-- Record ingredient order instead of sorting equal timestamps by random UUID.
alter table public.meal_items add column position integer;
-- Linked diary items recover their recipe order. Older unlinked items can only
-- retain a best-effort physical order; their original order was never stored.
with ordered as (
  select mi.id, (row_number() over (
    partition by mi.entry_id
    order by coalesce(mi.is_customization, false), coalesce(di.position, matched.position) nulls last,
      mi.created_at, mi.ctid
  ) - 1)::integer as position
  from public.meal_items mi
  join public.meal_entries e on e.id = mi.entry_id
  left join public.dish_items di on di.id = mi.dish_item_id
  left join lateral (
    select min(candidate.position) as position from public.dish_items candidate
    where candidate.dish_id = e.dish_id
      and ((mi.food_key is not null and candidate.food_key = mi.food_key)
        or (mi.food_key is null and candidate.food_name = mi.food_name))
  ) matched on true
)
update public.meal_items mi set position = ordered.position
from ordered where mi.id = ordered.id;
-- Older deployed clients can still insert without specifying a position.
create or replace function public.assign_meal_item_position()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.position is null then
    perform 1 from public.meal_entries where id = new.entry_id for update;
    select coalesce(max(position), -1) + 1 into new.position
    from public.meal_items where entry_id = new.entry_id;
  end if;
  return new;
end;
$$;
create trigger assign_meal_item_position_before_insert
before insert on public.meal_items
for each row execute function public.assign_meal_item_position();
alter table public.meal_items
  alter column position set not null,
  add constraint meal_items_position_nonnegative check (position >= 0);
create unique index meal_items_entry_position_idx on public.meal_items(entry_id, position);
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
