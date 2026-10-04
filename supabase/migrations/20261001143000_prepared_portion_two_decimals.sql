-- Preserve two-decimal cooked weights and portions entered by the user.
alter table public.prepared_batches
  alter column total_cooked_g type numeric(10, 2),
  alter column remaining_g type numeric(10, 2);
drop trigger adjust_prepared_batch_remaining_after_insert on public.meal_entries;
drop trigger adjust_prepared_batch_remaining_after_update on public.meal_entries;
drop trigger adjust_prepared_batch_remaining_after_delete on public.meal_entries;
alter table public.meal_entries
  alter column cooked_portion_g type numeric(10, 2);
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
