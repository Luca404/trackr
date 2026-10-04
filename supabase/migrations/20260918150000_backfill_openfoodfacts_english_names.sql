-- Correct names imported before name_en became the preferred field.
-- Only replace names that still equal the original generic product name, so
-- manually edited pantry names are left untouched.
update public.pantry_items
set name = trim(split_part(off_data->>'name_en', ',', 1))
where off_data is not null
  and nullif(trim(off_data->>'name_en'), '') is not null
  and name = off_data->>'product_name';
