-- Pantry nutrition is authoritative for linked recipe and diary ingredients.
-- Bring existing rows up to date. Keep optional nutrients already known in a
-- recipe or diary entry when the pantry has no value for them yet.
update public.dish_items di set
  calories = round((p.calories_100g * di.quantity_g / 100)::numeric),
  protein_g = round((p.protein_100g * di.quantity_g / 100)::numeric, 1),
  carbs_g = round((p.carbs_100g * di.quantity_g / 100)::numeric, 1),
  fat_g = round((p.fat_100g * di.quantity_g / 100)::numeric, 1),
  fiber_g = case when p.fiber_100g is null then di.fiber_g
    else round((p.fiber_100g * di.quantity_g / 100)::numeric, 2) end,
  sugars_g = case when p.sugars_100g is null then di.sugars_g
    else round((p.sugars_100g * di.quantity_g / 100)::numeric, 2) end,
  salt_g = case when p.salt_100g is null then di.salt_g
    else round((p.salt_100g * di.quantity_g / 100)::numeric, 2) end
from public.pantry_items p
where di.pantry_item_id = p.id;
update public.meal_items mi set
  calories = round((p.calories_100g * mi.quantity_g / 100)::numeric),
  protein_g = round((p.protein_100g * mi.quantity_g / 100)::numeric, 1),
  carbs_g = round((p.carbs_100g * mi.quantity_g / 100)::numeric, 1),
  fat_g = round((p.fat_100g * mi.quantity_g / 100)::numeric, 1),
  fiber_g = case when p.fiber_100g is null then mi.fiber_g
    else round((p.fiber_100g * mi.quantity_g / 100)::numeric, 2) end,
  sugars_g = case when p.sugars_100g is null then mi.sugars_g
    else round((p.sugars_100g * mi.quantity_g / 100)::numeric, 2) end,
  salt_g = case when p.salt_100g is null then mi.salt_g
    else round((p.salt_100g * mi.quantity_g / 100)::numeric, 2) end
from public.pantry_items p
where p.id = coalesce(
  (select di.pantry_item_id from public.dish_items di where di.id = mi.dish_item_id),
  mi.pantry_item_id
);
create or replace function public.sync_pantry_nutrition()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.dish_items di set
    calories = case when new.calories_100g is distinct from old.calories_100g
      then round((new.calories_100g * di.quantity_g / 100)::numeric) else di.calories end,
    protein_g = case when new.protein_100g is distinct from old.protein_100g
      then round((new.protein_100g * di.quantity_g / 100)::numeric, 1) else di.protein_g end,
    carbs_g = case when new.carbs_100g is distinct from old.carbs_100g
      then round((new.carbs_100g * di.quantity_g / 100)::numeric, 1) else di.carbs_g end,
    fat_g = case when new.fat_100g is distinct from old.fat_100g
      then round((new.fat_100g * di.quantity_g / 100)::numeric, 1) else di.fat_g end,
    fiber_g = case when new.fiber_100g is distinct from old.fiber_100g
      then round((new.fiber_100g * di.quantity_g / 100)::numeric, 2) else di.fiber_g end,
    sugars_g = case when new.sugars_100g is distinct from old.sugars_100g
      then round((new.sugars_100g * di.quantity_g / 100)::numeric, 2) else di.sugars_g end,
    salt_g = case when new.salt_100g is distinct from old.salt_100g
      then round((new.salt_100g * di.quantity_g / 100)::numeric, 2) else di.salt_g end
  where di.pantry_item_id = new.id;

  update public.meal_items mi set
    calories = case when new.calories_100g is distinct from old.calories_100g
      then round((new.calories_100g * mi.quantity_g / 100)::numeric) else mi.calories end,
    protein_g = case when new.protein_100g is distinct from old.protein_100g
      then round((new.protein_100g * mi.quantity_g / 100)::numeric, 1) else mi.protein_g end,
    carbs_g = case when new.carbs_100g is distinct from old.carbs_100g
      then round((new.carbs_100g * mi.quantity_g / 100)::numeric, 1) else mi.carbs_g end,
    fat_g = case when new.fat_100g is distinct from old.fat_100g
      then round((new.fat_100g * mi.quantity_g / 100)::numeric, 1) else mi.fat_g end,
    fiber_g = case when new.fiber_100g is distinct from old.fiber_100g
      then round((new.fiber_100g * mi.quantity_g / 100)::numeric, 2) else mi.fiber_g end,
    sugars_g = case when new.sugars_100g is distinct from old.sugars_100g
      then round((new.sugars_100g * mi.quantity_g / 100)::numeric, 2) else mi.sugars_g end,
    salt_g = case when new.salt_100g is distinct from old.salt_100g
      then round((new.salt_100g * mi.quantity_g / 100)::numeric, 2) else mi.salt_g end
  where exists (
    select 1 from public.dish_items di
    where di.id = mi.dish_item_id and di.pantry_item_id = new.id
  ) or (
    mi.pantry_item_id = new.id and not exists (
      select 1 from public.dish_items di
      where di.id = mi.dish_item_id and di.pantry_item_id is not null
    )
  );

  return new;
end;
$$;
create trigger sync_pantry_nutrition_after_update
after update of calories_100g, protein_100g, carbs_100g, fat_100g,
  fiber_100g, sugars_100g, salt_100g on public.pantry_items
for each row
when (
  old.calories_100g is distinct from new.calories_100g or
  old.protein_100g is distinct from new.protein_100g or
  old.carbs_100g is distinct from new.carbs_100g or
  old.fat_100g is distinct from new.fat_100g or
  old.fiber_100g is distinct from new.fiber_100g or
  old.sugars_100g is distinct from new.sugars_100g or
  old.salt_100g is distinct from new.salt_100g
)
execute function public.sync_pantry_nutrition();
