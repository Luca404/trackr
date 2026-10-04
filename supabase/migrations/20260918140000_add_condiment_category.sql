-- Keep sauces/condiments separate from pasta sauces while preserving existing
-- values. The new category groups oils, soy sauce, ketchup, mustard, etc.
alter table public.pantry_items drop constraint if exists pantry_items_category_check;
alter table public.pantry_items
  add constraint pantry_items_category_check check (category in (
    'grain','legume','vegetable','fruit','meat','fish','dairy','egg','fat',
    'sauce','condiment','seasoning','sweet','alcohol','beverage','other'
  ));
alter table public.meal_items drop constraint if exists meal_items_category_check;
alter table public.meal_items
  add constraint meal_items_category_check check (category in (
    'grain','legume','vegetable','fruit','meat','fish','dairy','egg','fat',
    'sauce','condiment','seasoning','sweet','alcohol','beverage','other'
  ));
alter table public.dish_items drop constraint if exists dish_items_category_check;
alter table public.dish_items
  add constraint dish_items_category_check check (category in (
    'grain','legume','vegetable','fruit','meat','fish','dairy','egg','fat',
    'sauce','condiment','seasoning','sweet','alcohol','beverage','other'
  ));
