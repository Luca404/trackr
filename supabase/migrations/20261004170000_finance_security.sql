-- Shared production database: finance policies only. No data deletion or multicurrency.
CREATE SCHEMA IF NOT EXISTS trackr_private;
REVOKE ALL ON SCHEMA trackr_private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA trackr_private TO authenticated, service_role;
CREATE OR REPLACE FUNCTION trackr_private.can_write_profile(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.profile_members m
 WHERE m.profile_id=p_id AND m.user_id=auth.uid() AND (m.role='editor' OR (m.role='owner' AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=m.profile_id AND p.user_id=auth.uid()))));
$$;
REVOKE ALL ON FUNCTION trackr_private.can_write_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION trackr_private.can_write_profile(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.is_profile_member(p_profile_id uuid,p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p_user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.profile_members
 WHERE profile_id=p_profile_id AND user_id=auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.is_profile_owner(p_profile_id uuid,p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p_user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.profiles
 WHERE id=p_profile_id AND user_id=auth.uid());
$$;
DO $$ DECLARE t text; r text; w text; pol text; BEGIN
 FOREACH t IN ARRAY ARRAY['accounts','categories','portfolios','transactions','transfers','recurring_transactions','orders','subcategories'] LOOP
  IF t='orders' THEN
   r := 'EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id=orders.portfolio_id AND public.is_profile_member(p.profile_id,auth.uid()))';
   w := 'EXISTS (SELECT 1 FROM public.portfolios p WHERE p.id=orders.portfolio_id AND trackr_private.can_write_profile(p.profile_id))';
  ELSIF t='subcategories' THEN
   r := 'EXISTS (SELECT 1 FROM public.categories c WHERE c.id=subcategories.category_id AND public.is_profile_member(c.profile_id,auth.uid()))';
   w := 'EXISTS (SELECT 1 FROM public.categories c WHERE c.id=subcategories.category_id AND trackr_private.can_write_profile(c.profile_id))';
  ELSE
   r := 'public.is_profile_member(profile_id,auth.uid())'; w := 'trackr_private.can_write_profile(profile_id)';
  END IF;
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
   EXECUTE format('DROP POLICY %I ON public.%I',pol,t);
  END LOOP;
  EXECUTE format('CREATE POLICY members_read ON public.%I FOR SELECT TO authenticated USING (%s)',t,r);
  EXECUTE format('CREATE POLICY editors_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',t,w);
  EXECUTE format('CREATE POLICY editors_update ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',t,w,w);
  EXECUTE format('CREATE POLICY editors_delete ON public.%I FOR DELETE TO authenticated USING (%s)',t,w);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon',t);
 END LOOP;
END $$;
DO $$ DECLARE pol text; BEGIN
 FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='profiles' LOOP
  EXECUTE format('DROP POLICY %I ON public.profiles',pol);
 END LOOP;
END $$;
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE POLICY profiles_delete ON public.profiles FOR DELETE TO authenticated USING(user_id=auth.uid() AND id<>user_id);
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.is_profile_member(id,auth.uid()) OR EXISTS(
 SELECT 1 FROM public.profile_share_invitations i WHERE i.profile_id=profiles.id AND lower(i.invited_email)=lower(auth.email()) AND i.status='pending' AND i.expires_at>now()));
DROP POLICY IF EXISTS owner_manage ON public.profile_members;
CREATE POLICY owner_update_members ON public.profile_members FOR UPDATE TO authenticated
 USING (user_id<>auth.uid() AND public.is_profile_owner(profile_id,auth.uid()))
 WITH CHECK (role<>'owner' AND public.is_profile_owner(profile_id,auth.uid()));
CREATE POLICY owner_remove_members ON public.profile_members FOR DELETE TO authenticated
 USING (user_id<>auth.uid() AND public.is_profile_owner(profile_id,auth.uid()));
-- Membership creation is handled by profile/invitation RPCs, never a client INSERT.
REVOKE INSERT ON public.profile_members FROM authenticated;
CREATE OR REPLACE FUNCTION trackr_private.create_owner_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
 INSERT INTO public.profile_members(profile_id,user_id,role,email)
 SELECT NEW.id,NEW.user_id,'owner',u.email FROM auth.users u WHERE u.id=NEW.user_id
 ON CONFLICT (profile_id,user_id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION trackr_private.create_owner_membership() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER create_owner_membership AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION trackr_private.create_owner_membership();

-- Reject profile hopping, creator spoofing, and cross-profile foreign keys.
-- SECURITY INVOKER deliberately keeps parent lookups subject to RLS.
CREATE OR REPLACE FUNCTION trackr_private.validate_finance_row() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE n jsonb:=to_jsonb(NEW); o jsonb; p uuid; parent uuid; field text; parent_table text; BEGIN
 IF TG_OP='UPDATE' THEN
  o:=to_jsonb(OLD);
  IF n->'id' IS DISTINCT FROM o->'id' OR n->'user_id' IS DISTINCT FROM o->'user_id'
   OR n->'profile_id' IS DISTINCT FROM o->'profile_id'
   OR (TG_TABLE_NAME='subcategories' AND n->'category_id' IS DISTINCT FROM o->'category_id')
    THEN
   RAISE EXCEPTION 'immutable_identity' USING ERRCODE='42501';
  END IF;
 ELSIF auth.uid() IS NOT NULL AND n ? 'user_id' AND (n->>'user_id')::uuid IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'invalid_creator' USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='profile_members' THEN
  IF n->>'role'='owner' THEN
   SELECT user_id INTO parent FROM public.profiles WHERE id=(n->>'profile_id')::uuid;
   IF parent IS DISTINCT FROM (n->>'user_id')::uuid THEN RAISE EXCEPTION 'invalid_owner_membership' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='profiles' THEN RETURN NEW; END IF;
 p:=(n->>'profile_id')::uuid;
 IF TG_TABLE_NAME='orders' THEN
  SELECT profile_id INTO p FROM public.portfolios WHERE id=(n->>'portfolio_id')::bigint;
  IF TG_OP='UPDATE' THEN
   SELECT profile_id INTO parent FROM public.portfolios WHERE id=(o->>'portfolio_id')::bigint;
   IF parent IS DISTINCT FROM p THEN RAISE EXCEPTION 'immutable_profile' USING ERRCODE='42501'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='subcategories' THEN
  SELECT profile_id INTO p FROM public.categories WHERE id=(n->>'category_id')::bigint;
 END IF;
 IF p IS NULL THEN RAISE EXCEPTION 'invalid_profile' USING ERRCODE='23514'; END IF;
 FOREACH field IN ARRAY ARRAY['account_id','from_account_id','to_account_id','portfolio_id','recurring_id','transaction_id'] LOOP
  IF n->>field IS NOT NULL THEN
   parent_table:=CASE field WHEN 'portfolio_id' THEN 'portfolios' WHEN 'recurring_id' THEN 'recurring_transactions'
    WHEN 'transaction_id' THEN 'transactions' ELSE 'accounts' END;
   EXECUTE format('SELECT profile_id FROM public.%I WHERE id=$1',parent_table) INTO parent USING (n->>field)::bigint;
   IF parent IS DISTINCT FROM p THEN RAISE EXCEPTION 'cross_profile_reference' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 IF TG_TABLE_NAME='transfers' AND n->>'from_account_id'=n->>'to_account_id' THEN
  RAISE EXCEPTION 'identical_transfer_accounts' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION trackr_private.validate_finance_row() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','profile_members','accounts','categories','portfolios','transactions','transfers','recurring_transactions','orders','subcategories'] LOOP
  EXECUTE format('CREATE TRIGGER validate_finance_row BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION trackr_private.validate_finance_row()',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.create_profile_invitation(p_profile_id uuid,p_email text,p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_email text:=lower(trim(p_email)); BEGIN
 IF auth.uid() IS NULL OR NOT public.is_profile_owner(p_profile_id,auth.uid()) THEN RAISE EXCEPTION 'not_owner'; END IF;
 IF p_role IS NULL OR p_role NOT IN ('editor','viewer') OR v_email IS NULL OR length(v_email)>254
  OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 -- Serialize all invitations by this sender, including unknown emails. No auth.users lookup.
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 IF (SELECT count(*) FROM public.profile_share_invitations WHERE invited_by=auth.uid() AND created_at>now()-interval '1 hour')>=10 THEN
  RAISE EXCEPTION 'rate_limited'; END IF;
 IF EXISTS(SELECT 1 FROM public.profile_members WHERE profile_id=p_profile_id AND lower(email)=v_email) THEN RAISE EXCEPTION 'already_member'; END IF;
 IF EXISTS(SELECT 1 FROM public.profile_share_invitations WHERE profile_id=p_profile_id AND lower(invited_email)=v_email
  AND status='pending' AND expires_at>now()) THEN RAISE EXCEPTION 'invite_pending'; END IF;
 INSERT INTO public.profile_share_invitations(profile_id,invited_email,invited_by,role)
 VALUES(p_profile_id,v_email,auth.uid(),p_role);
END $$;
CREATE OR REPLACE FUNCTION public.accept_profile_invitation(p_invitation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.profile_share_invitations; e text; BEGIN
 SELECT * INTO i FROM public.profile_share_invitations WHERE id=p_invitation_id FOR UPDATE;
 IF NOT FOUND OR i.status<>'pending' OR i.expires_at<=now() OR auth.uid() IS NULL THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 SELECT lower(email) INTO e FROM auth.users WHERE id=auth.uid();
 IF e IS NULL OR e IS DISTINCT FROM lower(i.invited_email) THEN RAISE EXCEPTION 'not_recipient'; END IF;
 INSERT INTO public.profile_members(profile_id,user_id,role,email) VALUES(i.profile_id,auth.uid(),i.role,e)
 ON CONFLICT(profile_id,user_id) DO NOTHING;
 UPDATE public.profile_share_invitations SET status='accepted' WHERE id=i.id;
END $$;
CREATE OR REPLACE FUNCTION public.cancel_profile_invitation(p_invitation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
 UPDATE public.profile_share_invitations SET status='cancelled' WHERE id=p_invitation_id AND status='pending'
 AND auth.uid() IS NOT NULL AND invited_by=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.reject_profile_invitation(p_invitation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN
 UPDATE public.profile_share_invitations SET status='rejected' WHERE id=p_invitation_id AND status='pending'
 AND expires_at>now() AND auth.uid() IS NOT NULL AND lower(invited_email)=lower(auth.email());
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
END $$;
DROP POLICY IF EXISTS cancel_own_invitation ON public.profile_share_invitations;
DROP POLICY IF EXISTS owner_insert_invitation ON public.profile_share_invitations;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.profile_share_invitations FROM authenticated;
REVOKE ALL ON public.profiles,public.profile_members,public.profile_share_invitations FROM anon;
-- Existing routines qualify their relations already. Pin their function search paths.
ALTER FUNCTION public.get_my_profiles() SET search_path='';
ALTER FUNCTION public.repair_own_membership() SET search_path='';
ALTER FUNCTION public.handle_new_user() SET search_path='';
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('get_my_profiles','repair_own_membership','handle_new_user',
   'is_profile_owner','is_profile_member','import_kakebo_profile_atomic','create_profile_invitation',
   'accept_profile_invitation','cancel_profile_invitation','reject_profile_invitation') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f);
  IF f::text NOT LIKE '%handle_new_user%' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',f); END IF;
 END LOOP;
END $$;
REVOKE TRUNCATE,REFERENCES,TRIGGER ON ALL TABLES IN SCHEMA public FROM anon,authenticated;
-- New public RPCs must opt in to anonymous access in both applications.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon;
NOTIFY pgrst,'reload schema';
