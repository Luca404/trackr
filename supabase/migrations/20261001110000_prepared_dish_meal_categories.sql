-- Keep prepared snapshots in the same meal categories as their saved recipe.
-- Occasional preparations belong to the meal where they were created.
create or replace function public.create_prepared_batch(
  p_user_id uuid, p_name text, p_items jsonb, p_source_dish_id uuid,
  p_icon text, p_total_cooked_g numeric, p_first_portion_g numeric,
  p_date date, p_meal_type text
)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
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
-- Existing snapshots linked to a saved recipe can inherit its categories.
update public.dishes snapshot set meal_types = source.meal_types
from public.prepared_batches batch
join public.dishes source on source.id = batch.source_dish_id
where snapshot.id = batch.snapshot_dish_id;
-- For an occasional preparation, a previously logged portion identifies its meal.
update public.dishes snapshot set meal_types = array[logged.meal_type]
from public.prepared_batches batch
join lateral (
  select m.meal_type from public.meal_entries entry
  join public.meals m on m.id = entry.meal_id
  where entry.prepared_batch_id = batch.id
  order by entry.created_at asc limit 1
) logged on true
where snapshot.id = batch.snapshot_dish_id and batch.source_dish_id is null;
