-- Preserve the complete Open Food Facts product payload for scanned pantry items.
-- The core nutrition columns remain denormalized for fast calculations and
-- this JSONB column keeps new OFF fields available without another migration.
alter table public.pantry_items
  add column if not exists off_data jsonb;
comment on column public.pantry_items.off_data is
  'Complete Open Food Facts product payload captured at import time';
