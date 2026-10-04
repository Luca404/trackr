SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
COMMENT ON SCHEMA "public" IS 'standard public schema';
CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, user_id, name)
  VALUES (new.id, new.id, 'Principale');
  RETURN new;
END;
$$;
ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";
CREATE OR REPLACE FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
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
ALTER FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") OWNER TO "postgres";
SET default_tablespace = '';
SET default_table_access_method = "heap";
CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "icon" "text" DEFAULT '💳'::"text" NOT NULL,
    "initial_balance" double precision DEFAULT 0 NOT NULL,
    "is_favorite" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "profile_id" "uuid"
);
ALTER TABLE "public"."accounts" OWNER TO "postgres";
CREATE SEQUENCE IF NOT EXISTS "public"."accounts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."accounts_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."accounts_id_seq" OWNED BY "public"."accounts"."id";
CREATE TABLE IF NOT EXISTS "public"."bond_metadata_cache" (
    "isin" "text" NOT NULL,
    "issuer" "text",
    "coupon" double precision,
    "maturity" "text",
    "currency" "text" DEFAULT 'EUR'::"text",
    "ytm_gross" double precision,
    "ytm_net" double precision,
    "duration" double precision,
    "coupon_frequency" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "name" "text" DEFAULT ''::"text"
);
ALTER TABLE "public"."bond_metadata_cache" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "category_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "color" "text",
    "profile_id" "uuid",
    CONSTRAINT "categories_category_type_check" CHECK ((("category_type" = ANY (ARRAY['expense'::"text", 'income'::"text", 'investment'::"text", 'transfer'::"text"])) OR ("category_type" IS NULL)))
);
ALTER TABLE "public"."categories" OWNER TO "postgres";
CREATE SEQUENCE IF NOT EXISTS "public"."categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."categories_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."categories_id_seq" OWNED BY "public"."categories"."id";
CREATE TABLE IF NOT EXISTS "public"."etf_ucits_cache" (
    "isin" "text" NOT NULL,
    "ticker" "text" NOT NULL,
    "exchange" "text" NOT NULL,
    "name" "text" DEFAULT ''::"text",
    "currency" "text" DEFAULT ''::"text",
    "ter" double precision,
    "created_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."etf_ucits_cache" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "portfolio_id" integer NOT NULL,
    "symbol" character varying NOT NULL,
    "isin" character varying,
    "name" character varying,
    "exchange" character varying,
    "currency" character varying DEFAULT 'EUR'::character varying,
    "quantity" numeric(20,8) NOT NULL,
    "price" numeric(12,4) NOT NULL,
    "commission" numeric(12,4) DEFAULT 0,
    "instrument_type" character varying,
    "order_type" character varying NOT NULL,
    "date" "date" NOT NULL,
    "ter" numeric(8,4),
    "transaction_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."orders" OWNER TO "postgres";
CREATE SEQUENCE IF NOT EXISTS "public"."orders_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."orders_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."orders_id_seq" OWNED BY "public"."orders"."id";
CREATE TABLE IF NOT EXISTS "public"."portfolios" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "initial_capital" double precision DEFAULT 0,
    "reference_currency" "text" DEFAULT 'EUR'::"text",
    "risk_free_source" "text" DEFAULT 'auto'::"text",
    "market_benchmark" "text" DEFAULT 'auto'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "profile_id" "uuid",
    "icon" "text",
    "color" "text",
    "history_mode" "text" DEFAULT 'full_orders'::"text" NOT NULL,
    CONSTRAINT "portfolios_history_mode_check" CHECK (("history_mode" = ANY (ARRAY['full_orders'::"text", 'positions_only'::"text"])))
);
ALTER TABLE "public"."portfolios" OWNER TO "postgres";
CREATE SEQUENCE IF NOT EXISTS "public"."portfolios_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."portfolios_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."portfolios_id_seq" OWNED BY "public"."portfolios"."id";
CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "name" "text" DEFAULT 'Principale'::"text" NOT NULL
);
ALTER TABLE "public"."profiles" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."recurring_transactions" (
    "id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "account_id" integer NOT NULL,
    "type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "subcategory" "text",
    "amount" numeric(10,2) NOT NULL,
    "description" "text",
    "frequency" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "next_due_date" "date" NOT NULL,
    "ticker" "text",
    "quantity" numeric,
    "price" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "profile_id" "uuid",
    "portfolio_id" bigint,
    "isin" "text",
    "instrument_name" "text",
    "exchange" "text",
    "instrument_type" "text",
    "order_type" "text" DEFAULT 'buy'::"text",
    "currency" "text" DEFAULT 'EUR'::"text",
    CONSTRAINT "recurring_transactions_frequency_check" CHECK (("frequency" = ANY (ARRAY['weekly'::"text", 'monthly'::"text", 'yearly'::"text"]))),
    CONSTRAINT "recurring_transactions_type_check" CHECK (("type" = ANY (ARRAY['expense'::"text", 'income'::"text", 'investment'::"text", 'transfer'::"text"])))
);
ALTER TABLE "public"."recurring_transactions" OWNER TO "postgres";
CREATE SEQUENCE IF NOT EXISTS "public"."recurring_transactions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."recurring_transactions_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."recurring_transactions_id_seq" OWNED BY "public"."recurring_transactions"."id";
CREATE TABLE IF NOT EXISTS "public"."stock_symbol_cache" (
    "symbol" "text" NOT NULL,
    "name" "text",
    "exchange" "text",
    "currency" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."stock_symbol_cache" OWNER TO "postgres";
CREATE TABLE IF NOT EXISTS "public"."subcategories" (
    "id" bigint NOT NULL,
    "category_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);
ALTER TABLE "public"."subcategories" OWNER TO "postgres";
CREATE SEQUENCE IF NOT EXISTS "public"."subcategories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."subcategories_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."subcategories_id_seq" OWNED BY "public"."subcategories"."id";
CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "account_id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "subcategory" "text",
    "amount" double precision NOT NULL,
    "description" "text",
    "date" "date" NOT NULL,
    "ticker" "text",
    "quantity" double precision,
    "price" double precision,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "recurring_id" integer,
    "profile_id" "uuid",
    CONSTRAINT "transactions_type_check" CHECK (("type" = ANY (ARRAY['expense'::"text", 'income'::"text", 'investment'::"text", 'transfer'::"text"])))
);
ALTER TABLE "public"."transactions" OWNER TO "postgres";
CREATE SEQUENCE IF NOT EXISTS "public"."transactions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."transactions_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."transactions_id_seq" OWNED BY "public"."transactions"."id";
CREATE TABLE IF NOT EXISTS "public"."transfers" (
    "id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "from_account_id" integer NOT NULL,
    "to_account_id" integer NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "description" "text",
    "date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "profile_id" "uuid",
    CONSTRAINT "transfers_amount_check" CHECK (("amount" > (0)::numeric))
);
ALTER TABLE "public"."transfers" OWNER TO "postgres";
CREATE SEQUENCE IF NOT EXISTS "public"."transfers_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE "public"."transfers_id_seq" OWNER TO "postgres";
ALTER SEQUENCE "public"."transfers_id_seq" OWNED BY "public"."transfers"."id";
ALTER TABLE ONLY "public"."accounts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."accounts_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."categories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."categories_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."orders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."orders_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."portfolios" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."portfolios_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."recurring_transactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."recurring_transactions_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."subcategories" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subcategories_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."transactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."transactions_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."transfers" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."transfers_id_seq"'::"regclass");
ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."bond_metadata_cache"
    ADD CONSTRAINT "bond_metadata_cache_pkey" PRIMARY KEY ("isin");
ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."etf_ucits_cache"
    ADD CONSTRAINT "etf_ucits_cache_pkey" PRIMARY KEY ("isin", "ticker", "exchange");
ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."portfolios"
    ADD CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."recurring_transactions"
    ADD CONSTRAINT "recurring_transactions_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."stock_symbol_cache"
    ADD CONSTRAINT "stock_symbol_cache_pkey" PRIMARY KEY ("symbol");
ALTER TABLE ONLY "public"."subcategories"
    ADD CONSTRAINT "subcategories_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_pkey" PRIMARY KEY ("id");
CREATE INDEX "idx_recurring_transactions_portfolio_id" ON "public"."recurring_transactions" USING "btree" ("portfolio_id");
ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."portfolios"
    ADD CONSTRAINT "portfolios_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."portfolios"
    ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."recurring_transactions"
    ADD CONSTRAINT "recurring_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."recurring_transactions"
    ADD CONSTRAINT "recurring_transactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."recurring_transactions"
    ADD CONSTRAINT "recurring_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."subcategories"
    ADD CONSTRAINT "subcategories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id");
ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_recurring_id_fkey" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_transactions"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;
ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
CREATE POLICY "Public read bond metadata" ON "public"."bond_metadata_cache" FOR SELECT USING (true);
CREATE POLICY "Users can delete own orders" ON "public"."orders" FOR DELETE USING (("auth"."uid"() = "user_id"));
CREATE POLICY "Users can delete own transfers" ON "public"."transfers" FOR DELETE USING (("auth"."uid"() = "user_id"));
CREATE POLICY "Users can insert own orders" ON "public"."orders" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));
CREATE POLICY "Users can insert own transfers" ON "public"."transfers" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));
CREATE POLICY "Users can update own orders" ON "public"."orders" FOR UPDATE USING (("auth"."uid"() = "user_id"));
CREATE POLICY "Users can update own transfers" ON "public"."transfers" FOR UPDATE USING (("auth"."uid"() = "user_id"));
CREATE POLICY "Users can view own orders" ON "public"."orders" FOR SELECT USING (("auth"."uid"() = "user_id"));
CREATE POLICY "Users can view own transfers" ON "public"."transfers" FOR SELECT USING (("auth"."uid"() = "user_id"));
CREATE POLICY "Users manage own recurring" ON "public"."recurring_transactions" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));
ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."bond_metadata_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."etf_ucits_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own data" ON "public"."accounts" USING (("user_id" = "auth"."uid"()));
CREATE POLICY "own data" ON "public"."categories" USING (("user_id" = "auth"."uid"()));
CREATE POLICY "own data" ON "public"."portfolios" USING (("user_id" = "auth"."uid"()));
CREATE POLICY "own data" ON "public"."profiles" USING (("id" = "auth"."uid"()));
CREATE POLICY "own data" ON "public"."subcategories" USING (("category_id" IN ( SELECT "categories"."id"
   FROM "public"."categories"
  WHERE ("categories"."user_id" = "auth"."uid"()))));
CREATE POLICY "own data" ON "public"."transactions" USING (("user_id" = "auth"."uid"()));
ALTER TABLE "public"."portfolios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_delete" ON "public"."profiles" FOR DELETE USING ((("user_id" = "auth"."uid"()) AND ("id" <> "user_id")));
CREATE POLICY "profiles_insert" ON "public"."profiles" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));
CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT USING (("user_id" = "auth"."uid"()));
CREATE POLICY "profiles_update" ON "public"."profiles" FOR UPDATE USING (("user_id" = "auth"."uid"()));
CREATE POLICY "public read" ON "public"."etf_ucits_cache" FOR SELECT USING (true);
CREATE POLICY "public read" ON "public"."stock_symbol_cache" FOR SELECT USING (true);
ALTER TABLE "public"."recurring_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."stock_symbol_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."subcategories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."transfers" ENABLE ROW LEVEL SECURITY;
ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";
GRANT ALL ON FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."import_kakebo_profile_atomic"("p_profile_id" "uuid", "p_payload" "jsonb") TO "service_role";
GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";
GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."accounts_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."bond_metadata_cache" TO "anon";
GRANT ALL ON TABLE "public"."bond_metadata_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."bond_metadata_cache" TO "service_role";
GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";
GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."categories_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."etf_ucits_cache" TO "anon";
GRANT ALL ON TABLE "public"."etf_ucits_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."etf_ucits_cache" TO "service_role";
GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."orders_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."portfolios" TO "anon";
GRANT ALL ON TABLE "public"."portfolios" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolios" TO "service_role";
GRANT ALL ON SEQUENCE "public"."portfolios_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."portfolios_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."portfolios_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT ALL ON TABLE "public"."recurring_transactions" TO "anon";
GRANT ALL ON TABLE "public"."recurring_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_transactions" TO "service_role";
GRANT ALL ON SEQUENCE "public"."recurring_transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."recurring_transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recurring_transactions_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."stock_symbol_cache" TO "anon";
GRANT ALL ON TABLE "public"."stock_symbol_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_symbol_cache" TO "service_role";
GRANT ALL ON TABLE "public"."subcategories" TO "anon";
GRANT ALL ON TABLE "public"."subcategories" TO "authenticated";
GRANT ALL ON TABLE "public"."subcategories" TO "service_role";
GRANT ALL ON SEQUENCE "public"."subcategories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subcategories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subcategories_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";
GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transactions_id_seq" TO "service_role";
GRANT ALL ON TABLE "public"."transfers" TO "anon";
GRANT ALL ON TABLE "public"."transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."transfers" TO "service_role";
GRANT ALL ON SEQUENCE "public"."transfers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transfers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transfers_id_seq" TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
drop extension if exists "pg_net";
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
