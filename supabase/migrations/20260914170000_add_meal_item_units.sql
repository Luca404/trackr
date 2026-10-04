-- Liquids are stored with their real display unit instead of pretending that
-- millilitres are grams. Existing ingredients remain grams by default.

alter table public.meal_items
  add column unit text not null default 'g'
  check (unit in ('g', 'ml'));
create or replace function public.add_meal_entry(
  p_user_id uuid,
  p_date date,
  p_meal_type text,
  p_name text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
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

  insert into public.meals (user_id, date, meal_type, name)
  values (p_user_id, p_date, p_meal_type, null)
  on conflict (user_id, date, meal_type) do update set name = public.meals.name
  returning * into v_meal;

  insert into public.meal_entries (meal_id, name)
  values (v_meal.id, trim(p_name))
  returning * into v_entry;

  with inserted as (
    insert into public.meal_items (
      meal_id, entry_id, food_name, quantity_g, unit, calories,
      protein_g, carbs_g, fat_g, source, off_food_id
    )
    select
      v_meal.id, v_entry.id, x.food_name, x.quantity_g, coalesce(x.unit, 'g'), x.calories,
      x.protein_g, x.carbs_g, x.fat_g, coalesce(x.source, 'manual'), x.off_food_id
    from jsonb_to_recordset(p_items) as x(
      food_name text, quantity_g float, unit text, calories float, protein_g float,
      carbs_g float, fat_g float, source text, off_food_id text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
  into v_items
  from inserted;

  return jsonb_build_object(
    'meal', to_jsonb(v_meal),
    'entry', to_jsonb(v_entry) || jsonb_build_object('items', v_items)
  );
end;
$$;
create or replace function public.update_meal_entry(
  p_entry_id uuid,
  p_name text,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
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

  update public.meal_entries e
  set name = trim(p_name)
  from public.meals m
  where e.id = p_entry_id
    and m.id = e.meal_id
    and m.user_id = auth.uid()
  returning e.* into v_entry;

  if not found then
    raise exception 'meal entry not found' using errcode = 'P0002';
  end if;

  delete from public.meal_items where entry_id = p_entry_id;

  with inserted as (
    insert into public.meal_items (
      meal_id, entry_id, food_name, quantity_g, unit, calories,
      protein_g, carbs_g, fat_g, source, off_food_id
    )
    select
      v_entry.meal_id, v_entry.id, x.food_name, x.quantity_g, coalesce(x.unit, 'g'), x.calories,
      x.protein_g, x.carbs_g, x.fat_g, coalesce(x.source, 'manual'), x.off_food_id
    from jsonb_to_recordset(p_items) as x(
      food_name text, quantity_g float, unit text, calories float, protein_g float,
      carbs_g float, fat_g float, source text, off_food_id text
    )
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
  into v_items
  from inserted;

  return to_jsonb(v_entry) || jsonb_build_object('items', v_items);
end;
$$;
