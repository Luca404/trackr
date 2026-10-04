-- Keep depleted stock out of the active pantry without losing diary links.
-- Restoring a logged meal can make the same pantry row active again.
alter table public.pantry_items add column archived_at timestamptz;
update public.pantry_items
set archived_at = now()
where quantity = 0;
create or replace function public.set_pantry_archive_state()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.quantity <= 0 then
    new.archived_at := coalesce(old.archived_at, now());
  else
    new.archived_at := null;
  end if;
  return new;
end;
$$;
create trigger set_pantry_archive_state_before_update
before update of quantity on public.pantry_items
for each row execute function public.set_pantry_archive_state();
