-- A measured remainder corrects the original yield, preserving weighed portions.
create function public.correct_prepared_batch_weight(
  p_batch_id uuid, p_remaining_g numeric,
  p_expected_remaining_g numeric, p_expected_total_cooked_g numeric
)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_batch public.prepared_batches%rowtype;
  v_consumed_g numeric;
  v_total_g numeric;
begin
  select * into v_batch from public.prepared_batches
  where id = p_batch_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'prepared dish not found' using errcode = 'P0002';
  end if;
  if v_batch.closed_at is not null or p_remaining_g is null
    or p_remaining_g::text in ('NaN', 'Infinity', '-Infinity')
    or p_remaining_g < 0 then
    raise exception 'invalid remaining weight' using errcode = '22023';
  end if;
  if p_expected_remaining_g is distinct from v_batch.remaining_g
    or p_expected_total_cooked_g is distinct from v_batch.total_cooked_g then
    raise exception 'preparation changed; reload before correcting' using errcode = '40001';
  end if;

  select coalesce(sum(e.cooked_portion_g), 0) into v_consumed_g
  from public.meal_entries e join public.meals m on m.id = e.meal_id
  where e.prepared_batch_id = v_batch.id and m.user_id = auth.uid();
  v_total_g := v_consumed_g + round(p_remaining_g, 2);
  if v_total_g <= 0 or v_total_g >= 100000000 then
    raise exception 'invalid total cooked weight' using errcode = '22023';
  end if;

  update public.prepared_batches
  set total_cooked_g = v_total_g, remaining_g = round(p_remaining_g, 2)
  where id = v_batch.id returning * into v_batch;

  -- quantity_g is the derived raw ingredient share, not the weighed cooked
  -- portion. Keep it in sync so later ingredient corrections use the new yield.
  -- The existing source-nutrition trigger recalculates all nutrients and keeps
  -- unknown optional values null. Extras and other batches are untouched.
  update public.meal_items mi
  set quantity_g = di.quantity_g * e.cooked_portion_g / v_total_g,
      piece_count = di.piece_count * e.cooked_portion_g / v_total_g
  from public.meal_entries e, public.meals m, public.dish_items di
  where e.prepared_batch_id = v_batch.id and e.meal_id = m.id
    and m.user_id = auth.uid() and mi.entry_id = e.id and mi.meal_id = m.id
    and mi.dish_item_id = di.id and di.dish_id = v_batch.snapshot_dish_id
    and not mi.is_customization;

  return to_jsonb(v_batch);
end;
$$;

revoke execute on function public.correct_prepared_batch_weight(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.correct_prepared_batch_weight(uuid, numeric, numeric, numeric) to authenticated;
