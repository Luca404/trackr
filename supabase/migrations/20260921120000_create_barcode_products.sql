-- Shared barcode catalog. Product data is non-personal and reusable by every
-- signed-in user. Clients may read it, while writes are reserved for trusted
-- Edge Functions using a secret/service-role key.
create table public.barcode_products (
  barcode               text primary key check (barcode ~ '^[0-9]+$' and length(barcode) in (8, 12, 13, 14)),
  name                  text not null check (length(trim(name)) > 0),
  brand                 text,
  package_quantity      text,
  quantity_value        double precision check (quantity_value is null or quantity_value > 0),
  quantity_unit         text check (quantity_unit is null or quantity_unit in ('g', 'ml', 'pz')),
  serving_size          text,
  ingredients           text,
  allergens             text,
  calories_100g         double precision not null check (calories_100g >= 0),
  protein_100g          double precision not null check (protein_100g >= 0),
  carbs_100g            double precision not null check (carbs_100g >= 0),
  fat_100g              double precision not null check (fat_100g >= 0),
  fiber_100g            double precision check (fiber_100g is null or fiber_100g >= 0),
  sugars_100g           double precision check (sugars_100g is null or sugars_100g >= 0),
  saturated_fat_100g    double precision check (saturated_fat_100g is null or saturated_fat_100g >= 0),
  unsaturated_fat_100g  double precision check (unsaturated_fat_100g is null or unsaturated_fat_100g >= 0),
  salt_100g             double precision check (salt_100g is null or salt_100g >= 0),
  category              text not null default 'other' check (category in (
                          'grain','bakery','legume','vegetable','fruit','nuts_seeds',
                          'meat','fish','dairy','egg','plant_protein','spread','fat',
                          'sauce','condiment','seasoning','sweet','snack','prepared',
                          'supplement','alcohol','beverage','other')),
  source                text not null check (source in ('openfoodfacts', 'ai_photo')),
  off_food_id           text,
  confidence            text check (confidence is null or confidence in ('high', 'medium', 'low')),
  metadata              jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.barcode_products enable row level security;
create policy "authenticated users read barcode_products"
  on public.barcode_products for select
  using (auth.uid() is not null);
alter table public.pantry_items
  add column barcode text check (
    barcode is null or (barcode ~ '^[0-9]+$' and length(barcode) in (8, 12, 13, 14))
  );
create index pantry_items_barcode_idx on public.pantry_items (user_id, barcode)
  where barcode is not null;
-- Existing Open Food Facts scans already use their barcode as off_food_id.
update public.pantry_items
set barcode = off_food_id
where barcode is null
  and off_food_id ~ '^[0-9]+$'
  and length(off_food_id) in (8, 12, 13, 14);
-- Seed the shared catalog from already confirmed pantry products. Prefer the
-- most recently inserted copy when more than one user has the same barcode.
insert into public.barcode_products (
  barcode, name, brand, package_quantity, serving_size, ingredients, allergens,
  calories_100g, protein_100g, carbs_100g, fat_100g, fiber_100g, sugars_100g,
  saturated_fat_100g, unsaturated_fat_100g, salt_100g, category, source,
  off_food_id, confidence, metadata, created_at, updated_at
)
select distinct on (p.barcode)
  p.barcode,
  p.name,
  nullif(p.off_data->>'brands', ''),
  nullif(p.off_data->>'quantity', ''),
  nullif(p.off_data->>'serving_size', ''),
  coalesce(
    nullif(p.off_data->>'ingredients_text_it', ''),
    nullif(p.off_data->>'ingredients_text_en', ''),
    nullif(p.off_data->>'ingredients_text', '')
  ),
  nullif(p.off_data->>'allergens', ''),
  p.calories_100g,
  p.protein_100g,
  p.carbs_100g,
  p.fat_100g,
  p.fiber_100g,
  p.sugars_100g,
  p.saturated_fat_100g,
  p.unsaturated_fat_100g,
  p.salt_100g,
  coalesce(p.category, 'other'),
  case when p.source = 'ai_photo' then 'ai_photo' else 'openfoodfacts' end,
  p.off_food_id,
  case when p.source = 'ai_photo' then 'medium' else 'high' end,
  p.off_data,
  coalesce(p.created_at, now()),
  now()
from public.pantry_items p
where p.barcode is not null
order by p.barcode, p.created_at desc
on conflict (barcode) do nothing;
comment on table public.barcode_products is
  'Shared read-only product cache populated by trusted Edge Functions from Open Food Facts or OpenAI';
