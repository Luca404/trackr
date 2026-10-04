-- Keep the measured cooked yield and per-ingredient cooking choices on the
-- reusable recipe. The signature lets the client ignore a calibration after
-- ingredients have changed. Prepared snapshots do not need these preferences.
alter table public.dishes
  add column cooking_signature text,
  add column cooking_methods jsonb not null default '[]'::jsonb
    check (jsonb_typeof(cooking_methods) = 'array'),
  add column measured_yield_ratio numeric(10, 5)
    check (measured_yield_ratio is null or measured_yield_ratio > 0);
