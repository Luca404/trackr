-- Preserve the recipe's insertion order and allow an optional custom emoji.
alter table public.dishes
  add column icon text check (icon is null or (length(trim(icon)) between 1 and 16));
alter table public.dish_items
  add column position integer;
-- Historical inserts did not store an ordinal. Physical row order is a
-- best-effort tie-breaker for items inserted in the same transaction; their
-- original order cannot be guaranteed or recovered with certainty.
with ordered as (
  select id, (row_number() over (
    partition by dish_id order by created_at asc nulls last, ctid asc
  ) - 1)::integer as position
  from public.dish_items
)
update public.dish_items item
set position = ordered.position
from ordered
where item.id = ordered.id;
alter table public.dish_items
  alter column position set not null,
  add constraint dish_items_position_nonnegative check (position >= 0);
create unique index dish_items_dish_position_idx
  on public.dish_items (dish_id, position);
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
      dish_id, position, food_name, quantity_g, category, food_key, pantry_item_id,
      calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, source,
      off_food_id
    )
    select
      v_dish.id, (element.ordinal - 1)::integer, x.food_name, x.quantity_g,
      coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories,
      x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
      coalesce(x.source, 'manual'), x.off_food_id
    from jsonb_array_elements(p_items) with ordinality as element(value, ordinal)
    cross join lateral jsonb_to_record(element.value) as x(
      food_name text, quantity_g double precision, category text, food_key text,
      pantry_item_id uuid, calories double precision, protein_g double precision,
      carbs_g double precision, fat_g double precision, fiber_g double precision,
      sugars_g double precision, salt_g double precision, source text, off_food_id text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.position), '[]'::jsonb)
    into v_items from inserted;

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
      dish_id, position, food_name, quantity_g, category, food_key, pantry_item_id,
      calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, source,
      off_food_id
    )
    select
      p_dish_id, (element.ordinal - 1)::integer, x.food_name, x.quantity_g,
      coalesce(x.category, 'other'), x.food_key, x.pantry_item_id, x.calories,
      x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g, x.salt_g,
      coalesce(x.source, 'manual'), x.off_food_id
    from jsonb_array_elements(p_items) with ordinality as element(value, ordinal)
    cross join lateral jsonb_to_record(element.value) as x(
      food_name text, quantity_g double precision, category text, food_key text,
      pantry_item_id uuid, calories double precision, protein_g double precision,
      carbs_g double precision, fat_g double precision, fiber_g double precision,
      sugars_g double precision, salt_g double precision, source text, off_food_id text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.position), '[]'::jsonb)
    into v_items from inserted;

  return to_jsonb(v_dish) || jsonb_build_object('items', v_items);
end;
$$;
