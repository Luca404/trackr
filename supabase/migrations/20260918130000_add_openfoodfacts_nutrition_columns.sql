-- Keep frequently used Open Food Facts values queryable without parsing JSONB.
alter table public.pantry_items
  add column if not exists fiber_100g double precision,
  add column if not exists sugars_100g double precision,
  add column if not exists saturated_fat_100g double precision,
  add column if not exists unsaturated_fat_100g double precision,
  add column if not exists salt_100g double precision,
  add column if not exists nutrition_score double precision,
  add column if not exists nutrition_grade text,
  add column if not exists nova_group integer,
  add column if not exists ecoscore_grade text;
comment on column public.pantry_items.nutrition_score is 'Open Food Facts Nutri-Score numeric score';
comment on column public.pantry_items.nutrition_grade is 'Open Food Facts Nutri-Score grade';
comment on column public.pantry_items.unsaturated_fat_100g is 'Total fat minus saturated fat when not supplied by Open Food Facts';
