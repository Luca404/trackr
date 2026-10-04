-- Add practical categories for foods that do not fit the original macro-based
-- groups, and keep previously saved common foods aligned with the new taxonomy.
alter table public.pantry_items drop constraint if exists pantry_items_category_check;
alter table public.meal_items drop constraint if exists meal_items_category_check;
alter table public.dish_items drop constraint if exists dish_items_category_check;
update public.pantry_items
set category = case
  when lower(name) ~ '(burro d.arachidi|peanut butter|marmellat|confettur|miele|honey)' then 'spread'
  when lower(name) ~ '(mandorl|\mnoci\M|nocciol|pistacch|anacard|arachidi|semi di|chia)' then 'nuts_seeds'
  when lower(name) ~ '(\mpane\M|grissin|fette biscottate|cracker|croissant|cornett|focacci)' then 'bakery'
  else category
end
where category in ('grain', 'fat', 'sweet', 'dairy', 'legume', 'other');
update public.meal_items
set category = case
  when lower(food_name) ~ '(burro d.arachidi|peanut butter|marmellat|confettur|miele|honey)' then 'spread'
  when lower(food_name) ~ '(mandorl|\mnoci\M|nocciol|pistacch|anacard|arachidi|semi di|chia)' then 'nuts_seeds'
  when lower(food_name) ~ '(\mpane\M|grissin|fette biscottate|cracker|croissant|cornett|focacci)' then 'bakery'
  else category
end
where category in ('grain', 'fat', 'sweet', 'dairy', 'legume', 'other');
update public.dish_items
set category = case
  when lower(food_name) ~ '(burro d.arachidi|peanut butter|marmellat|confettur|miele|honey)' then 'spread'
  when lower(food_name) ~ '(mandorl|\mnoci\M|nocciol|pistacch|anacard|arachidi|semi di|chia)' then 'nuts_seeds'
  when lower(food_name) ~ '(\mpane\M|grissin|fette biscottate|cracker|croissant|cornett|focacci)' then 'bakery'
  else category
end
where category in ('grain', 'fat', 'sweet', 'dairy', 'legume', 'other');
alter table public.pantry_items add constraint pantry_items_category_check check (category in (
  'grain','bakery','legume','vegetable','fruit','nuts_seeds','meat','fish','dairy','egg',
  'plant_protein','spread','fat','sauce','condiment','seasoning','sweet','snack','prepared',
  'supplement','alcohol','beverage','other'
));
alter table public.meal_items add constraint meal_items_category_check check (category in (
  'grain','bakery','legume','vegetable','fruit','nuts_seeds','meat','fish','dairy','egg',
  'plant_protein','spread','fat','sauce','condiment','seasoning','sweet','snack','prepared',
  'supplement','alcohol','beverage','other'
));
alter table public.dish_items add constraint dish_items_category_check check (category in (
  'grain','bakery','legume','vegetable','fruit','nuts_seeds','meat','fish','dairy','egg',
  'plant_protein','spread','fat','sauce','condiment','seasoning','sweet','snack','prepared',
  'supplement','alcohol','beverage','other'
));
