alter table public.user_health_profiles
  drop constraint if exists user_health_profiles_objective_check;
alter table public.user_health_profiles
  add constraint user_health_profiles_objective_check
  check (objective in ('lose_weight', 'gain_muscle', 'maintain', 'recomposition'));
