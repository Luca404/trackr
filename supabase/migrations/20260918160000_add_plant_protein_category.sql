-- Keep tofu, tempeh, seitan and meat-alternative products separate from
-- vegetables and unprocessed legumes.
alter table public.pantry_items
  drop constraint if exists pantry_items_category_check,
  add constraint pantry_items_category_check check (category in (
    'grain','legume','vegetable','fruit','meat','fish','dairy','egg',
    'plant_protein','fat','sauce','condiment','seasoning','sweet','alcohol','beverage','other'
  ));
alter table public.meal_items
  drop constraint if exists meal_items_category_check,
  add constraint meal_items_category_check check (category in (
    'grain','legume','vegetable','fruit','meat','fish','dairy','egg',
    'plant_protein','fat','sauce','condiment','seasoning','sweet','alcohol','beverage','other'
  ));
alter table public.dish_items
  drop constraint if exists dish_items_category_check,
  add constraint dish_items_category_check check (category in (
    'grain','legume','vegetable','fruit','meat','fish','dairy','egg',
    'plant_protein','fat','sauce','condiment','seasoning','sweet','alcohol','beverage','other'
  ));
