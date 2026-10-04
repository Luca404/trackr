CREATE OR REPLACE FUNCTION public.save_financial_order(p_profile_id uuid,p_order_id bigint,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE o public.orders; old_o public.orders; t public.transactions; v jsonb; BEGIN
 IF NOT trackr_private.can_write_profile(p_profile_id) THEN RAISE EXCEPTION 'not_editor' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance:'||p_profile_id::text,0));
 IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_payload'; END IF;
 SELECT ord.* INTO old_o FROM public.orders ord JOIN public.portfolios p ON p.id=ord.portfolio_id
 WHERE ord.id=p_order_id AND p.profile_id=p_profile_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
 -- Take transaction locks before order locks, just as transaction edits do.
 IF old_o.transaction_id IS NOT NULL THEN
  SELECT * INTO t FROM public.transactions WHERE id=old_o.transaction_id;
  PERFORM 1 FROM public.recurring_transactions WHERE id=t.recurring_id FOR UPDATE;
  PERFORM 1 FROM public.transactions WHERE id=t.id FOR UPDATE;
 END IF;
 SELECT * INTO old_o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 o:=jsonb_populate_record(old_o,p_payload);
 IF o.quantity<=0 OR o.price<0 OR o.commission<0 OR o.order_type NOT IN ('buy','sell') THEN RAISE EXCEPTION 'invalid_order'; END IF;
 IF old_o.transaction_id IS NOT NULL THEN
  v:=jsonb_build_object('ticker',o.symbol,'isin',o.isin,'instrument_name',o.name,'exchange',o.exchange,
   'instrument_type',o.instrument_type,'order_type',o.order_type,'ter',o.ter,'portfolio_id',old_o.portfolio_id,
   'quantity',o.quantity,'price',o.price,'date',o.date,'description',o.description,
   'amount',(o.quantity*o.price+coalesce(o.commission,0))*CASE WHEN o.order_type='sell' THEN -1 ELSE 1 END);
  PERFORM public.save_financial_transaction(p_profile_id,old_o.transaction_id,v);
 ELSE
  UPDATE public.orders SET symbol=o.symbol,isin=o.isin,name=o.name,exchange=o.exchange,quantity=o.quantity,
   price=o.price,commission=o.commission,instrument_type=o.instrument_type,order_type=o.order_type,date=o.date,
   ter=o.ter,description=o.description WHERE id=p_order_id;
 END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 RETURN to_jsonb(o);
END $$;
REVOKE ALL ON FUNCTION public.save_financial_order(uuid,bigint,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_financial_order(uuid,bigint,jsonb) TO authenticated,service_role;
-- Enforce finite numeric input on future writes; historical rows remain intact.
ALTER TABLE public.transactions ADD CONSTRAINT transactions_finite_values CHECK
 (amount>'-Infinity'::float8 AND amount<'Infinity'::float8 AND
 (CASE WHEN type='investment' THEN amount<>0 ELSE amount>0 END) AND
 (quantity IS NULL OR (quantity>0 AND quantity<'Infinity'::float8)) AND
 (price IS NULL OR (price>=0 AND price<'Infinity'::float8))) NOT VALID;
ALTER TABLE public.accounts ADD CONSTRAINT accounts_finite_balance CHECK
 (initial_balance>'-Infinity'::float8 AND initial_balance<'Infinity'::float8) NOT VALID;
ALTER TABLE public.orders ADD CONSTRAINT orders_valid_values CHECK
 (quantity>0 AND quantity<'Infinity'::numeric AND price>=0 AND price<'Infinity'::numeric
 AND commission>=0 AND commission<'Infinity'::numeric AND order_type IN ('buy','sell')) NOT VALID;
NOTIFY pgrst,'reload schema';
ALTER TABLE public.transfers ADD CONSTRAINT transfers_finite_amount CHECK(amount<'Infinity'::numeric) NOT VALID;
ALTER TABLE public.recurring_transactions ADD CONSTRAINT recurring_finite_amount CHECK(amount>'-Infinity'::numeric AND amount<'Infinity'::numeric AND (CASE WHEN type='investment' THEN amount<>0 ELSE amount>0 END)) NOT VALID;
ALTER TABLE public.portfolios ADD CONSTRAINT portfolios_finite_capital CHECK(initial_capital>'-Infinity'::float8 AND initial_capital<'Infinity'::float8) NOT VALID;
