-- Keep every existing saved dish visible until the owner chooses precise categories.
alter table public.dishes
  add column meal_types text[] not null default array['breakfast','lunch','dinner','snack']::text[]
  check (cardinality(meal_types) > 0 and meal_types <@ array['breakfast','lunch','dinner','snack']::text[]);
create or replace function public.create_dish_with_categories(
  p_user_id uuid, p_name text, p_items jsonb, p_meal_types text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
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
create or replace function public.update_dish_with_categories(
  p_dish_id uuid, p_name text, p_items jsonb, p_meal_types text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
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
revoke execute on function public.create_dish_with_categories(uuid, text, jsonb, text[]) from public, anon;
revoke execute on function public.update_dish_with_categories(uuid, text, jsonb, text[]) from public, anon;
grant execute on function public.create_dish_with_categories(uuid, text, jsonb, text[]) to authenticated;
grant execute on function public.update_dish_with_categories(uuid, text, jsonb, text[]) to authenticated;
