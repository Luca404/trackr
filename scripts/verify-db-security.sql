-- Supabase CLI login roles assume postgres, as the CLI schema dump does.
SET ROLE postgres;
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SELECT jsonb_build_object(
 'tables_without_rls',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity),
 'legacy_finance_all_policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN('accounts','categories','portfolios','transactions','transfers','recurring_transactions','orders','subcategories') AND cmd='ALL'),
 'cross_profile_transactions',(SELECT count(*) FROM public.transactions t JOIN public.accounts a ON a.id=t.account_id LEFT JOIN public.recurring_transactions r ON r.id=t.recurring_id WHERE t.profile_id IS DISTINCT FROM a.profile_id OR (t.recurring_id IS NOT NULL AND t.profile_id IS DISTINCT FROM r.profile_id)),
 'cross_profile_recurring',(SELECT count(*) FROM public.recurring_transactions r JOIN public.accounts a ON a.id=r.account_id LEFT JOIN public.portfolios p ON p.id=r.portfolio_id WHERE r.profile_id IS DISTINCT FROM a.profile_id OR (r.portfolio_id IS NOT NULL AND r.profile_id IS DISTINCT FROM p.profile_id)),
 'cross_profile_transfers',(SELECT count(*) FROM public.transfers t JOIN public.accounts a ON a.id=t.from_account_id JOIN public.accounts b ON b.id=t.to_account_id WHERE t.profile_id IS DISTINCT FROM a.profile_id OR t.profile_id IS DISTINCT FROM b.profile_id),
 'cross_profile_orders',(SELECT count(*) FROM public.orders o JOIN public.portfolios p ON p.id=o.portfolio_id LEFT JOIN public.transactions t ON t.id=o.transaction_id WHERE o.transaction_id IS NOT NULL AND p.profile_id IS DISTINCT FROM t.profile_id),
 'inconsistent_meal_items',(SELECT count(*) FROM public.meal_items i JOIN public.meal_entries e ON e.id=i.entry_id WHERE i.meal_id IS DISTINCT FROM e.meal_id),
 'invalid_owner_memberships',(SELECT count(*) FROM public.profile_members m JOIN public.profiles p ON p.id=m.profile_id WHERE m.role='owner' AND m.user_id IS DISTINCT FROM p.user_id),
 'profiles_without_owner',(SELECT count(*) FROM public.profiles WHERE user_id IS NULL),
 'transactions_without_profile',(SELECT count(*) FROM public.transactions WHERE profile_id IS NULL),
 'duplicate_recurring_occurrence_groups',(SELECT count(*) FROM(SELECT recurring_id,coalesce(recurring_due_date,date) FROM public.transactions WHERE recurring_id IS NOT NULL GROUP BY recurring_id,coalesce(recurring_due_date,date) HAVING count(*)>1) duplicate_groups),
 'unvalidated_security_constraints',(SELECT count(*) FROM pg_constraint WHERE conname IN('transactions_finite_values','accounts_finite_balance','orders_valid_values','transfers_finite_amount','recurring_finite_amount','portfolios_finite_capital','meal_items_entry_meal_fk') AND NOT convalidated),
 'anonymous_finance_rpc_execute',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('is_profile_member','is_profile_owner','create_profile_invitation','accept_profile_invitation','cancel_profile_invitation','reject_profile_invitation','get_my_profiles','repair_own_membership','import_kakebo_profile_atomic','save_financial_transaction','save_financial_order','process_recurring_transactions','delete_financial_transaction','delete_financial_order','delete_financial_portfolio','export_financial_profile') AND has_function_privilege('anon',p.oid,'EXECUTE')),
 'anonymous_private_schema_usage',has_schema_privilege('anon','trackr_private','USAGE')
);
COMMIT;
