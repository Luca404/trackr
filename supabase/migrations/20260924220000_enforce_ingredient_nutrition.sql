-- Restore authoritative nutrition for ingredients already linked to pantry rows.
update public.dish_items di set
  calories = round((p.calories_100g * di.quantity_g / 100)::numeric),
  protein_g = round((p.protein_100g * di.quantity_g / 100)::numeric, 1),
  carbs_g = round((p.carbs_100g * di.quantity_g / 100)::numeric, 1),
  fat_g = round((p.fat_100g * di.quantity_g / 100)::numeric, 1),
  fiber_g = case when p.fiber_100g is null then di.fiber_g else round((p.fiber_100g * di.quantity_g / 100)::numeric, 2) end,
  sugars_g = case when p.sugars_100g is null then di.sugars_g else round((p.sugars_100g * di.quantity_g / 100)::numeric, 2) end,
  salt_g = case when p.salt_100g is null then di.salt_g else round((p.salt_100g * di.quantity_g / 100)::numeric, 2) end
from public.pantry_items p
where di.pantry_item_id = p.id;
update public.meal_items mi set
  calories = round((p.calories_100g * mi.quantity_g / 100)::numeric),
  protein_g = round((p.protein_100g * mi.quantity_g / 100)::numeric, 1),
  carbs_g = round((p.carbs_100g * mi.quantity_g / 100)::numeric, 1),
  fat_g = round((p.fat_100g * mi.quantity_g / 100)::numeric, 1),
  fiber_g = case when p.fiber_100g is null then mi.fiber_g else round((p.fiber_100g * mi.quantity_g / 100)::numeric, 2) end,
  sugars_g = case when p.sugars_100g is null then mi.sugars_g else round((p.sugars_100g * mi.quantity_g / 100)::numeric, 2) end,
  salt_g = case when p.salt_100g is null then mi.salt_g else round((p.salt_100g * mi.quantity_g / 100)::numeric, 2) end
from public.pantry_items p
where p.id = coalesce(
  (select di.pantry_item_id from public.dish_items di where di.id = mi.dish_item_id),
  mi.pantry_item_id
);
create or replace function public.apply_pantry_nutrition_to_dish_item()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pantry public.pantry_items%rowtype;
begin
  if new.pantry_item_id is null then return new; end if;
  select * into v_pantry from public.pantry_items where id = new.pantry_item_id;
  if not found then return new; end if;

  new.calories := round((v_pantry.calories_100g * new.quantity_g / 100)::numeric);
  new.protein_g := round((v_pantry.protein_100g * new.quantity_g / 100)::numeric, 1);
  new.carbs_g := round((v_pantry.carbs_100g * new.quantity_g / 100)::numeric, 1);
  new.fat_g := round((v_pantry.fat_100g * new.quantity_g / 100)::numeric, 1);
  if v_pantry.fiber_100g is not null then
    new.fiber_g := round((v_pantry.fiber_100g * new.quantity_g / 100)::numeric, 2);
  end if;
  if v_pantry.sugars_100g is not null then
    new.sugars_g := round((v_pantry.sugars_100g * new.quantity_g / 100)::numeric, 2);
  end if;
  if v_pantry.salt_100g is not null then
    new.salt_g := round((v_pantry.salt_100g * new.quantity_g / 100)::numeric, 2);
  end if;
  return new;
end;
$$;
create trigger dish_item_nutrition_from_pantry
before insert or update of quantity_g, pantry_item_id, calories, protein_g,
  carbs_g, fat_g, fiber_g, sugars_g, salt_g on public.dish_items
for each row execute function public.apply_pantry_nutrition_to_dish_item();
create or replace function public.apply_source_nutrition_to_meal_item()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dish_item public.dish_items%rowtype;
  v_pantry public.pantry_items%rowtype;
begin
  if new.dish_item_id is not null then
    select * into v_dish_item from public.dish_items where id = new.dish_item_id;
  end if;
  if coalesce(v_dish_item.pantry_item_id, new.pantry_item_id) is not null then
    select * into v_pantry from public.pantry_items
    where id = coalesce(v_dish_item.pantry_item_id, new.pantry_item_id);
  end if;

  if v_pantry.id is not null then
    new.calories := round((v_pantry.calories_100g * new.quantity_g / 100)::numeric);
    new.protein_g := round((v_pantry.protein_100g * new.quantity_g / 100)::numeric, 1);
    new.carbs_g := round((v_pantry.carbs_100g * new.quantity_g / 100)::numeric, 1);
    new.fat_g := round((v_pantry.fat_100g * new.quantity_g / 100)::numeric, 1);
    if v_pantry.fiber_100g is not null then
      new.fiber_g := round((v_pantry.fiber_100g * new.quantity_g / 100)::numeric, 2);
    elsif v_dish_item.id is not null and v_dish_item.fiber_g is not null then
      new.fiber_g := round((v_dish_item.fiber_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2);
    end if;
    if v_pantry.sugars_100g is not null then
      new.sugars_g := round((v_pantry.sugars_100g * new.quantity_g / 100)::numeric, 2);
    elsif v_dish_item.id is not null and v_dish_item.sugars_g is not null then
      new.sugars_g := round((v_dish_item.sugars_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2);
    end if;
    if v_pantry.salt_100g is not null then
      new.salt_g := round((v_pantry.salt_100g * new.quantity_g / 100)::numeric, 2);
    elsif v_dish_item.id is not null and v_dish_item.salt_g is not null then
      new.salt_g := round((v_dish_item.salt_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2);
    end if;
  elsif v_dish_item.id is not null then
    new.calories := round((v_dish_item.calories * new.quantity_g / v_dish_item.quantity_g)::numeric);
    new.protein_g := round((v_dish_item.protein_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 1);
    new.carbs_g := round((v_dish_item.carbs_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 1);
    new.fat_g := round((v_dish_item.fat_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 1);
    new.fiber_g := case when v_dish_item.fiber_g is null then null
      else round((v_dish_item.fiber_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2) end;
    new.sugars_g := case when v_dish_item.sugars_g is null then null
      else round((v_dish_item.sugars_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2) end;
    new.salt_g := case when v_dish_item.salt_g is null then null
      else round((v_dish_item.salt_g * new.quantity_g / v_dish_item.quantity_g)::numeric, 2) end;
  end if;
  return new;
end;
$$;
create trigger meal_item_nutrition_from_source
before insert or update of quantity_g, dish_item_id, pantry_item_id, calories,
  protein_g, carbs_g, fat_g, fiber_g, sugars_g, salt_g on public.meal_items
for each row execute function public.apply_source_nutrition_to_meal_item();
