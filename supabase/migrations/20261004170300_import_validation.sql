-- Reject empty/malformed/oversized input before destructive import work.
CREATE OR REPLACE FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_key text;
  v_total integer := 0;
  v_user_id uuid;
  v_profile_user_id uuid;
  v_existing_portfolio_ids bigint[];
  v_rec jsonb;
  v_accounts_count integer := 0;
  v_categories_count integer := 0;
  v_subcategories_count integer := 0;
  v_portfolios_count integer := 0;
  v_transactions_count integer := 0;
  v_transfers_count integer := 0;
  v_orders_count integer := 0;
  v_recurring_count integer := 0;
  v_new_account_id bigint;
  v_new_category_id bigint;
  v_new_portfolio_id bigint;
  v_new_transaction_id bigint;
  v_transaction_id bigint;
  v_portfolio_id bigint;
  v_account_id bigint;
  v_new_recurring_id integer;
  v_inserted_rows integer;
begin

  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>20971520 then
    raise exception 'invalid_import_payload';
  end if;
  foreach v_key in array array['accounts','categories','portfolios','transactions','transfers','orders','recurring_transactions'] loop
    if jsonb_typeof(p_payload->v_key) is distinct from 'array' then raise exception 'invalid_import_payload'; end if;
    v_total := v_total + jsonb_array_length(p_payload->v_key);
  end loop;
  for v_rec in select value from jsonb_array_elements(p_payload->'categories') loop
    if jsonb_typeof(coalesce(v_rec->'subcategories','[]'::jsonb)) is distinct from 'array' then raise exception 'invalid_import_payload'; end if;
    v_total := v_total + jsonb_array_length(coalesce(v_rec->'subcategories','[]'::jsonb));
  end loop;
  if v_total=0 or v_total>100000 or jsonb_array_length(p_payload->'accounts')=0 then
    raise exception 'invalid_import_payload';
  end if;
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select user_id
    into v_profile_user_id
  from public.profiles
  where id = p_profile_id
  for update;

  if v_profile_user_id is null then
    raise exception 'Profile not found';
  end if;

  if v_profile_user_id <> auth.uid() then
    raise exception 'Forbidden';
  end if;

  v_user_id := v_profile_user_id;

  create temp table tmp_account_map (
    source_conto_id integer primary key,
    account_id bigint not null
  ) on commit drop;

  create temp table tmp_category_map (
    category_key text primary key,
    category_id bigint not null
  ) on commit drop;

  create temp table tmp_portfolio_map (
    source_conto_id integer primary key,
    portfolio_id bigint not null
  ) on commit drop;

  create temp table tmp_transaction_map (
    transaction_key text primary key,
    transaction_id bigint not null
  ) on commit drop;

  create temp table tmp_recurring_map (
    recurring_key text primary key,
    recurring_id integer not null
  ) on commit drop;

  select array_agg(id)
    into v_existing_portfolio_ids
  from public.portfolios
  where profile_id = p_profile_id;

  delete from public.recurring_transactions
  where profile_id = p_profile_id;

  if coalesce(array_length(v_existing_portfolio_ids, 1), 0) > 0 then
    delete from public.orders
    where portfolio_id = any(v_existing_portfolio_ids);
  end if;

  delete from public.transactions
  where profile_id = p_profile_id;

  delete from public.transfers
  where profile_id = p_profile_id;

  delete from public.accounts
  where profile_id = p_profile_id;

  delete from public.categories
  where profile_id = p_profile_id;

  delete from public.portfolios
  where profile_id = p_profile_id;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'portfolios', '[]'::jsonb))
  loop
    insert into public.portfolios (
      user_id,
      profile_id,
      name,
      initial_capital,
      reference_currency,
      risk_free_source,
      market_benchmark,
      icon,
      color,
      history_mode
    ) values (
      v_user_id,
      p_profile_id,
      coalesce(v_rec->>'name', ''),
      coalesce((v_rec->>'initial_capital')::double precision, 0),
      coalesce(nullif(v_rec->>'reference_currency', ''), 'EUR'),
      coalesce(nullif(v_rec->>'risk_free_source', ''), 'auto'),
      coalesce(nullif(v_rec->>'market_benchmark', ''), 'auto'),
      nullif(v_rec->>'icon', ''),
      nullif(v_rec->>'color', ''),
      coalesce(nullif(v_rec->>'history_mode', ''), 'full_orders')
    )
    returning id into v_new_portfolio_id;

    insert into tmp_portfolio_map (source_conto_id, portfolio_id)
    values ((v_rec->>'source_conto_id')::integer, v_new_portfolio_id);

    v_portfolios_count := v_portfolios_count + 1;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'accounts', '[]'::jsonb))
  loop
    insert into public.accounts (
      user_id,
      profile_id,
      name,
      icon,
      initial_balance
    ) values (
      v_user_id,
      p_profile_id,
      coalesce(v_rec->>'name', ''),
      coalesce(nullif(v_rec->>'icon', ''), '🏦'),
      coalesce((v_rec->>'initial_balance')::double precision, 0)
    )
    returning id into v_new_account_id;

    insert into tmp_account_map (source_conto_id, account_id)
    values ((v_rec->>'source_conto_id')::integer, v_new_account_id);

    v_accounts_count := v_accounts_count + 1;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'categories', '[]'::jsonb))
  loop
    insert into public.categories (
      user_id,
      profile_id,
      name,
      icon,
      category_type,
      color
    ) values (
      v_user_id,
      p_profile_id,
      coalesce(v_rec->>'name', ''),
      coalesce(nullif(v_rec->>'icon', ''), case when v_rec->>'type' = 'income' then '💰' else '💸' end),
      nullif(v_rec->>'type', ''),
      nullif(v_rec->>'color', '')
    )
    returning id into v_new_category_id;

    insert into tmp_category_map (category_key, category_id)
    values (
      coalesce(v_rec->>'key', lower(coalesce(v_rec->>'name', '')) || '|' || coalesce(v_rec->>'type', '')),
      v_new_category_id
    );

    v_categories_count := v_categories_count + 1;

    insert into public.subcategories (category_id, name)
    select v_new_category_id, value
    from jsonb_array_elements_text(coalesce(v_rec->'subcategories', '[]'::jsonb));

    get diagnostics v_inserted_rows = row_count;
    v_subcategories_count := v_subcategories_count + v_inserted_rows;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'recurring_transactions', '[]'::jsonb))
  loop
    select account_id into v_account_id
    from tmp_account_map
    where source_conto_id = (v_rec->>'source_conto_id')::integer;

    if v_account_id is null then
      raise exception 'Missing recurring account mapping for source_conto_id %', v_rec->>'source_conto_id';
    end if;

    v_portfolio_id := null;
    if nullif(v_rec->>'source_portfolio_conto_id', '') is not null then
      select portfolio_id into v_portfolio_id
      from tmp_portfolio_map
      where source_conto_id = (v_rec->>'source_portfolio_conto_id')::integer;
    end if;

    insert into public.recurring_transactions (
      user_id,
      profile_id,
      account_id,
      type,
      portfolio_id,
      category,
      subcategory,
      amount,
      description,
      frequency,
      start_date,
      next_due_date,
      ticker,
      isin,
      instrument_name,
      exchange,
      instrument_type,
      order_type,
      currency,
      quantity,
      price
    ) values (
      v_user_id,
      p_profile_id,
      v_account_id,
      v_rec->>'type',
      v_portfolio_id,
      v_rec->>'category',
      nullif(v_rec->>'subcategory', ''),
      coalesce((v_rec->>'amount')::numeric, 0),
      nullif(v_rec->>'description', ''),
      v_rec->>'frequency',
      (v_rec->>'start_date')::date,
      (v_rec->>'next_due_date')::date,
      nullif(v_rec->>'ticker', ''),
      nullif(v_rec->>'isin', ''),
      nullif(v_rec->>'instrument_name', ''),
      nullif(v_rec->>'exchange', ''),
      nullif(v_rec->>'instrument_type', ''),
      nullif(v_rec->>'order_type', ''),
      nullif(v_rec->>'currency', ''),
      nullif(v_rec->>'quantity', '')::numeric,
      nullif(v_rec->>'price', '')::numeric
    )
    returning id into v_new_recurring_id;

    if nullif(v_rec->>'recurring_key', '') is not null then
      insert into tmp_recurring_map (recurring_key, recurring_id)
      values (v_rec->>'recurring_key', v_new_recurring_id);
    end if;

    v_recurring_count := v_recurring_count + 1;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'transactions', '[]'::jsonb))
  loop
    select account_id into v_account_id
    from tmp_account_map
    where source_conto_id = (v_rec->>'source_conto_id')::integer;

    if v_account_id is null then
      raise exception 'Missing account mapping for source_conto_id %', v_rec->>'source_conto_id';
    end if;

    insert into public.transactions (
      user_id,
      profile_id,
      account_id,
      type,
      category,
      subcategory,
      amount,
      description,
      date,
      ticker,
      quantity,
      price,
      recurring_id
    ) values (
      v_user_id,
      p_profile_id,
      v_account_id,
      v_rec->>'type',
      v_rec->>'category',
      nullif(v_rec->>'subcategory', ''),
      coalesce((v_rec->>'amount')::double precision, 0),
      nullif(v_rec->>'description', ''),
      (v_rec->>'date')::date,
      nullif(v_rec->>'ticker', ''),
      nullif(v_rec->>'quantity', '')::double precision,
      nullif(v_rec->>'price', '')::double precision,
      (select recurring_id from tmp_recurring_map where recurring_key = nullif(v_rec->>'recurring_key', ''))
    )
    returning id into v_new_transaction_id;

    if nullif(v_rec->>'transaction_key', '') is not null then
      insert into tmp_transaction_map (transaction_key, transaction_id)
      values (v_rec->>'transaction_key', v_new_transaction_id);
    end if;

    v_transactions_count := v_transactions_count + 1;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'transfers', '[]'::jsonb))
  loop
    insert into public.transfers (
      user_id,
      profile_id,
      from_account_id,
      to_account_id,
      amount,
      description,
      date
    ) values (
      v_user_id,
      p_profile_id,
      (select account_id from tmp_account_map where source_conto_id = (v_rec->>'from_source_conto_id')::integer),
      (select account_id from tmp_account_map where source_conto_id = (v_rec->>'to_source_conto_id')::integer),
      coalesce((v_rec->>'amount')::numeric, 0),
      nullif(v_rec->>'description', ''),
      (v_rec->>'date')::date
    );
    v_transfers_count := v_transfers_count + 1;
  end loop;

  for v_rec in
    select value
    from jsonb_array_elements(coalesce(p_payload->'orders', '[]'::jsonb))
  loop
    select portfolio_id into v_portfolio_id
    from tmp_portfolio_map
    where source_conto_id = (v_rec->>'source_portfolio_conto_id')::integer;

    if v_portfolio_id is null then
      raise exception 'Missing portfolio mapping for source_portfolio_conto_id %', v_rec->>'source_portfolio_conto_id';
    end if;

    v_transaction_id := null;
    if nullif(v_rec->>'transaction_key', '') is not null then
      select transaction_id into v_transaction_id
      from tmp_transaction_map
      where transaction_key = v_rec->>'transaction_key';
    end if;

    insert into public.orders (
      user_id,
      portfolio_id,
      symbol,
      isin,
      name,
      exchange,
      currency,
      quantity,
      price,
      commission,
      instrument_type,
      order_type,
      date,
      ter,
      transaction_id
    ) values (
      v_user_id,
      v_portfolio_id,
      v_rec->>'symbol',
      nullif(v_rec->>'isin', ''),
      nullif(v_rec->>'name', ''),
      nullif(v_rec->>'exchange', ''),
      coalesce(nullif(v_rec->>'currency', ''), 'EUR'),
      coalesce((v_rec->>'quantity')::numeric, 0),
      coalesce((v_rec->>'price')::numeric, 0),
      coalesce((v_rec->>'commission')::numeric, 0),
      v_rec->>'instrument_type',
      coalesce(nullif(v_rec->>'order_type', ''), 'buy'),
      (v_rec->>'date')::date,
      nullif(v_rec->>'ter', '')::numeric,
      v_transaction_id
    );

    v_orders_count := v_orders_count + 1;
  end loop;

  return jsonb_build_object(
    'accounts', v_accounts_count,
    'categories', v_categories_count,
    'subcategories', v_subcategories_count,
    'portfolios', v_portfolios_count,
    'transactions', v_transactions_count,
    'transfers', v_transfers_count,
    'orders', v_orders_count,
    'recurring', v_recurring_count
  );
end;
$$;
REVOKE ALL ON FUNCTION public.import_kakebo_profile_atomic(uuid,jsonb) FROM PUBLIC,anon;
