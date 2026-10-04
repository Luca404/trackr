-- Keep package count and net weight separate. AI products are inserted only
-- after an authenticated user confirms the extracted and editable values.
alter table public.barcode_products
  add column package_piece_count integer check (package_piece_count is null or package_piece_count > 0),
  add column package_net_quantity_value double precision check (
    package_net_quantity_value is null or package_net_quantity_value > 0
  ),
  add column package_net_quantity_unit text check (
    package_net_quantity_unit is null or package_net_quantity_unit in ('g', 'ml')
  );
update public.barcode_products
set
  package_piece_count = case
    when quantity_unit = 'pz' and quantity_value = trunc(quantity_value) then quantity_value::integer
    else null
  end,
  package_net_quantity_value = case when quantity_unit in ('g', 'ml') then quantity_value else null end,
  package_net_quantity_unit = case when quantity_unit in ('g', 'ml') then quantity_unit else null end;
comment on column public.barcode_products.package_piece_count is
  'Explicit package item count; never inferred by multiplying a serving weight';
comment on column public.barcode_products.package_net_quantity_value is
  'Explicit printed net package weight or volume';
comment on column public.barcode_products.package_net_quantity_unit is
  'Unit for the explicit printed net package quantity';
