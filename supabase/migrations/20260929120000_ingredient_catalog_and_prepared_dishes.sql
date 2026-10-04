-- Personal ingredients are reusable nutrition records, not a stock ledger.
alter table public.pantry_items
  add column nutrition_unit text not null default 'g' check (nutrition_unit in ('g', 'ml'));
update public.pantry_items set nutrition_unit = 'ml' where unit = 'ml';
drop trigger if exists set_pantry_archive_state_before_update on public.pantry_items;
drop function if exists public.set_pantry_archive_state();
update public.pantry_items set archived_at = null where archived_at is not null;
alter table public.pantry_items
  alter column quantity set default 1,
  alter column unit set default 'g';
-- Preserve the nutrition basis of linked ingredients in saved recipes.
alter table public.dish_items
  add column unit text not null default 'g' check (unit in ('g', 'ml'));
update public.dish_items di set unit = p.nutrition_unit
from public.pantry_items p where di.pantry_item_id = p.id;
create or replace function public.set_dish_item_unit_from_ingredient()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.pantry_item_id is not null then
    select p.nutrition_unit into new.unit from public.pantry_items p
    where p.id = new.pantry_item_id;
  end if;
  return new;
end;
$$;
create trigger dish_item_unit_from_ingredient
before insert or update of pantry_item_id on public.dish_items
for each row execute function public.set_dish_item_unit_from_ingredient();
-- A preparation owns an independent snapshot of the recipe in dishes/dish_items.
alter table public.dishes add column is_preparation boolean not null default false;
create index dishes_user_id_regular_idx on public.dishes (user_id, name) where not is_preparation;
create table public.prepared_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  snapshot_dish_id uuid not null unique references public.dishes(id) on delete cascade,
  source_dish_id uuid references public.dishes(id) on delete set null,
  total_cooked_g numeric(10, 1) not null check (total_cooked_g > 0),
  remaining_g numeric(10, 1) not null check (remaining_g >= 0 and remaining_g <= total_cooked_g),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.prepared_batches enable row level security;
create policy "own prepared_batches" on public.prepared_batches
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index prepared_batches_active_idx on public.prepared_batches (user_id, created_at desc)
  where closed_at is null and remaining_g > 0;
alter table public.meal_entries
  add column prepared_batch_id uuid references public.prepared_batches(id) on delete set null,
  add column cooked_portion_g numeric(10, 1),
  add constraint meal_entries_cooked_portion_check
    check (cooked_portion_g is null or cooked_portion_g > 0),
  add constraint meal_entries_prepared_portion_check
    check (prepared_batch_id is null or cooked_portion_g is not null);
create index meal_entries_prepared_batch_idx on public.meal_entries (prepared_batch_id)
  where prepared_batch_id is not null;
-- The entry itself is the ledger for a cooked portion. This also restores a
-- portion if its diary entry is deleted directly under RLS.
create or replace function public.adjust_prepared_batch_remaining()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'DELETE' then
    if old.prepared_batch_id is not null then
      update public.prepared_batches
      set remaining_g = least(total_cooked_g, remaining_g + old.cooked_portion_g)
      where id = old.prepared_batch_id;
    end if;
    return old;
  end if;

  select user_id into v_user_id from public.meals where id = new.meal_id;
  if new.prepared_batch_id is not null and not exists (
    select 1 from public.prepared_batches
    where id = new.prepared_batch_id and user_id = v_user_id
      and snapshot_dish_id = new.dish_id
  ) then
    raise exception 'prepared dish not found' using errcode = 'P0002';
  end if;

  if tg_op = 'UPDATE' and old.prepared_batch_id is not null then
    update public.prepared_batches
    set remaining_g = least(total_cooked_g, remaining_g + old.cooked_portion_g)
    where id = old.prepared_batch_id;
  end if;
  if new.prepared_batch_id is not null then
    update public.prepared_batches
    set remaining_g = remaining_g - new.cooked_portion_g
    where id = new.prepared_batch_id and remaining_g >= new.cooked_portion_g;
    if not found then
      raise exception 'not enough prepared dish remains' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger adjust_prepared_batch_remaining_after_insert
after insert on public.meal_entries
for each row when (new.prepared_batch_id is not null)
execute function public.adjust_prepared_batch_remaining();
create trigger adjust_prepared_batch_remaining_after_update
after update of prepared_batch_id, cooked_portion_g on public.meal_entries
for each row when (old.prepared_batch_id is distinct from new.prepared_batch_id
  or old.cooked_portion_g is distinct from new.cooked_portion_g)
execute function public.adjust_prepared_batch_remaining();
create trigger adjust_prepared_batch_remaining_after_delete
after delete on public.meal_entries
for each row when (old.prepared_batch_id is not null)
execute function public.adjust_prepared_batch_remaining();
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
    calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, source, off_food_id
  )
  select v_meal.id, v_entry.id, x.dish_item_id,
    coalesce(x.is_customization, p_dish_id is not null and x.dish_item_id is null),
    x.food_name, x.quantity_g, x.piece_count, x.piece_size, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id,
    x.calories, x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g,
    x.salt_g, coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_to_recordset(p_items) as x(
    dish_item_id uuid, is_customization boolean, food_name text, quantity_g float,
    piece_count float, piece_size text, unit text, category text, food_key text,
    pantry_item_id uuid, calories float, protein_g float, carbs_g float,
    fat_g float, fiber_g float, sugars_g float, salt_g float, source text, off_food_id text
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
    calories, protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g, source, off_food_id
  )
  select v_entry.meal_id, v_entry.id, x.dish_item_id,
    coalesce(x.is_customization, v_entry.dish_id is not null and x.dish_item_id is null),
    x.food_name, x.quantity_g, x.piece_count, x.piece_size, coalesce(x.unit, 'g'),
    coalesce(x.category, 'other'), x.food_key, x.pantry_item_id,
    x.calories, x.protein_g, x.carbs_g, x.fat_g, x.fiber_g, x.sugars_g,
    x.salt_g, coalesce(x.source, 'manual'), x.off_food_id
  from jsonb_to_recordset(p_items) as x(
    dish_item_id uuid, is_customization boolean, food_name text, quantity_g float,
    piece_count float, piece_size text, unit text, category text, food_key text,
    pantry_item_id uuid, calories float, protein_g float, carbs_g float,
    fat_g float, fiber_g float, sugars_g float, salt_g float, source text, off_food_id text
  );
  select coalesce(jsonb_agg(to_jsonb(mi) order by mi.created_at, mi.id), '[]'::jsonb)
  into v_items from public.meal_items mi where mi.entry_id = v_entry.id;
  return to_jsonb(v_entry) || jsonb_build_object('items', v_items);
end;
$$;
create or replace function public.delete_meal_entry(p_entry_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_meal_id uuid;
  v_user_id uuid;
begin
  select e.meal_id, m.user_id into v_meal_id, v_user_id
  from public.meal_entries e join public.meals m on m.id = e.meal_id
  where e.id = p_entry_id and m.user_id = auth.uid();
  if not found then
    raise exception 'meal entry not found' using errcode = 'P0002';
  end if;
  delete from public.meal_entries where id = p_entry_id;
  delete from public.meals m
  where m.id = v_meal_id and m.user_id = v_user_id
    and not exists (select 1 from public.meal_entries e where e.meal_id = m.id);
end;
$$;
-- Keep the obsolete stock columns during rollout so the currently deployed
-- client remains compatible. New code never reads or writes stock values.

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
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0 or p_total_cooked_g is null or p_total_cooked_g <= 0 then
    raise exception 'invalid preparation' using errcode = '22023';
  end if;
  if p_source_dish_id is not null and not exists (
    select 1 from public.dishes where id = p_source_dish_id
      and user_id = p_user_id and not is_preparation
  ) then
    raise exception 'saved dish not found' using errcode = 'P0002';
  end if;
  v_snapshot := public.create_dish_with_items(p_user_id, p_name, p_items);
  update public.dishes set is_preparation = true, icon = p_icon
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
create or replace function public.consume_prepared_batch(
  p_batch_id uuid, p_date date, p_meal_type text, p_grams numeric
)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_batch public.prepared_batches%rowtype;
  v_name text;
  v_result jsonb;
  v_entry public.meal_entries%rowtype;
begin
  select * into v_batch from public.prepared_batches
  where id = p_batch_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'prepared dish not found' using errcode = 'P0002';
  end if;
  if v_batch.closed_at is not null or p_grams is null or p_grams <= 0
    or p_grams > v_batch.remaining_g then
    raise exception 'invalid prepared portion' using errcode = '22023';
  end if;
  select name into v_name from public.dishes where id = v_batch.snapshot_dish_id;
  v_result := public.add_meal_entry(
    v_batch.user_id, p_date, p_meal_type, v_name,
    public.prepared_portion_items(p_batch_id, p_grams), v_batch.snapshot_dish_id
  );
  update public.meal_entries
  set prepared_batch_id = p_batch_id, cooked_portion_g = p_grams
  where id = (v_result->'entry'->>'id')::uuid
  returning * into v_entry;
  return jsonb_set(v_result, '{entry}',
    to_jsonb(v_entry) || jsonb_build_object('items', v_result->'entry'->'items'));
end;
$$;
create or replace function public.update_prepared_portion(p_entry_id uuid, p_grams numeric)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_entry public.meal_entries%rowtype;
  v_batch public.prepared_batches%rowtype;
  v_result jsonb;
begin
  select e.* into v_entry from public.meal_entries e
  join public.meals m on m.id = e.meal_id
  where e.id = p_entry_id and m.user_id = auth.uid() for update of e;
  if not found or v_entry.prepared_batch_id is null then
    raise exception 'prepared portion not found' using errcode = 'P0002';
  end if;
  select * into v_batch from public.prepared_batches
  where id = v_entry.prepared_batch_id and user_id = auth.uid() for update;
  if not found or p_grams is null or p_grams <= 0
    or p_grams > v_batch.remaining_g + v_entry.cooked_portion_g then
    raise exception 'invalid prepared portion' using errcode = '22023';
  end if;
  v_result := public.update_meal_entry(
    p_entry_id, v_entry.name, public.prepared_portion_items(v_batch.id, p_grams)
  );
  update public.meal_entries set cooked_portion_g = p_grams
  where id = p_entry_id returning * into v_entry;
  return to_jsonb(v_entry) || jsonb_build_object('items', v_result->'items');
end;
$$;
create or replace function public.close_prepared_batch(p_batch_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
begin
  update public.prepared_batches set closed_at = now()
  where id = p_batch_id and user_id = auth.uid() and closed_at is null;
  if not found then
    raise exception 'prepared dish not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.prepared_portion_items(uuid, numeric) from public, anon;
revoke execute on function public.create_prepared_batch(uuid, text, jsonb, uuid, text, numeric, numeric, date, text) from public, anon;
revoke execute on function public.consume_prepared_batch(uuid, date, text, numeric) from public, anon;
revoke execute on function public.update_prepared_portion(uuid, numeric) from public, anon;
revoke execute on function public.close_prepared_batch(uuid) from public, anon;
grant execute on function public.prepared_portion_items(uuid, numeric) to authenticated;
grant execute on function public.create_prepared_batch(uuid, text, jsonb, uuid, text, numeric, numeric, date, text) to authenticated;
grant execute on function public.consume_prepared_batch(uuid, date, text, numeric) to authenticated;
grant execute on function public.update_prepared_portion(uuid, numeric) to authenticated;
grant execute on function public.close_prepared_batch(uuid) to authenticated;
