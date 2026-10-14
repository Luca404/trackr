-- Optional measured distance; old clients/rows continue to use NULL.
alter table public.workouts add column distance_km double precision
  check (distance_km > 0 and distance_km <= 1000);

comment on column public.workouts.distance_km is
  'Optional distance in km; calorie estimates combine it with duration and body weight.';
