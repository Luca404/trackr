-- Treat a consumed dish as a first-class diary entry. Ingredients remain
-- attached to that entry and are shown only in its detail/edit view.

create table public.meal_entries (
  id         uuid primary key default gen_random_uuid(),
  meal_id    uuid not null references public.meals on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);
alter table public.meal_entries enable row level security;
create policy "own meal_entries" on public.meal_entries
  using (exists (
    select 1 from public.meals m
    where m.id = meal_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.meals m
    where m.id = meal_id and m.user_id = auth.uid()
  ));
create index meal_entries_meal_id_created_at_idx
  on public.meal_entries (meal_id, created_at);
alter table public.meal_items add column entry_id uuid;
-- Legacy rows did not know which dish they belonged to. The best lossless
-- conversion is one named dish per existing meal slot, preserving every item.
insert into public.meal_entries (id, meal_id, name, created_at)
select
  m.id,
  m.id,
  coalesce(
    nullif(trim(m.name), ''),
    case m.meal_type
      when 'breakfast' then 'Colazione registrata'
      when 'lunch' then 'Pranzo registrato'
      when 'dinner' then 'Cena registrata'
      when 'snack' then 'Spuntino registrato'
      when 'drinks' then 'Drink registrati'
      else 'Piatto registrato'
    end
  ),
  m.created_at
from public.meals m
where exists (select 1 from public.meal_items i where i.meal_id = m.id);
update public.meal_items set entry_id = meal_id where entry_id is null;
alter table public.meal_items
  alter column entry_id set not null,
  add constraint meal_items_entry_id_fkey
    foreign key (entry_id) references public.meal_entries on delete cascade;
create index meal_items_entry_id_created_at_idx
  on public.meal_items (entry_id, created_at);
drop policy if exists "own meal_items" on public.meal_items;
create policy "own meal_items" on public.meal_items
  using (exists (
    select 1
    from public.meal_entries e
    join public.meals m on m.id = e.meal_id
    where e.id = entry_id and e.meal_id = meal_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1
    from public.meal_entries e
    join public.meals m on m.id = e.meal_id
    where e.id = entry_id and e.meal_id = meal_id and m.user_id = auth.uid()
  ));
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
      meal_id, entry_id, food_name, quantity_g, calories,
      protein_g, carbs_g, fat_g, source, off_food_id
    )
    select
      v_meal.id, v_entry.id, x.food_name, x.quantity_g, x.calories,
      x.protein_g, x.carbs_g, x.fat_g, coalesce(x.source, 'manual'), x.off_food_id
    from jsonb_to_recordset(p_items) as x(
      food_name text, quantity_g float, calories float, protein_g float,
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
      meal_id, entry_id, food_name, quantity_g, calories,
      protein_g, carbs_g, fat_g, source, off_food_id
    )
    select
      v_entry.meal_id, v_entry.id, x.food_name, x.quantity_g, x.calories,
      x.protein_g, x.carbs_g, x.fat_g, coalesce(x.source, 'manual'), x.off_food_id
    from jsonb_to_recordset(p_items) as x(
      food_name text, quantity_g float, calories float, protein_g float,
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
create or replace function public.delete_meal_entry(p_entry_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_meal_id uuid;
begin
  delete from public.meal_entries e
  using public.meals m
  where e.id = p_entry_id
    and m.id = e.meal_id
    and m.user_id = auth.uid()
  returning e.meal_id into v_meal_id;

  if not found then
    raise exception 'meal entry not found' using errcode = 'P0002';
  end if;

  delete from public.meals m
  where m.id = v_meal_id
    and m.user_id = auth.uid()
    and not exists (
      select 1 from public.meal_entries e where e.meal_id = m.id
    );
end;
$$;
revoke execute on function public.add_meal_entry(uuid, date, text, text, jsonb) from public, anon;
revoke execute on function public.update_meal_entry(uuid, text, jsonb) from public, anon;
revoke execute on function public.delete_meal_entry(uuid) from public, anon;
grant execute on function public.add_meal_entry(uuid, date, text, text, jsonb) to authenticated;
grant execute on function public.update_meal_entry(uuid, text, jsonb) to authenticated;
grant execute on function public.delete_meal_entry(uuid) to authenticated;
drop function public.add_meal_items(uuid, date, text, jsonb);
