-- Reconcile main sharing on older local installations; idempotent on hosted DB.
-- No multicurrency, data reset, or fitness schema rewrite.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS description text;

CREATE TABLE IF NOT EXISTS "public"."profile_members" (
    "profile_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "email" "text",
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profile_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'editor'::"text", 'viewer'::"text"])))
);

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.profile_members'::regclass AND conname='profile_members_pkey') THEN
ALTER TABLE ONLY "public"."profile_members"
    ADD CONSTRAINT "profile_members_pkey" PRIMARY KEY ("profile_id", "user_id");
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.profile_members'::regclass AND conname='profile_members_profile_id_fkey') THEN
ALTER TABLE ONLY "public"."profile_members"
    ADD CONSTRAINT "profile_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.profile_members'::regclass AND conname='profile_members_user_id_fkey') THEN
ALTER TABLE ONLY "public"."profile_members"
    ADD CONSTRAINT "profile_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
END IF; END $$;

ALTER TABLE public.profile_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.profile_members TO authenticated;
GRANT ALL ON public.profile_members TO service_role;

CREATE TABLE IF NOT EXISTS "public"."profile_share_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "invited_email" "text" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    CONSTRAINT "profile_share_invitations_role_check" CHECK (("role" = ANY (ARRAY['editor'::"text", 'viewer'::"text"]))),
    CONSTRAINT "profile_share_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'rejected'::"text", 'cancelled'::"text"])))
);

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.profile_share_invitations'::regclass AND conname='profile_share_invitations_pkey') THEN
ALTER TABLE ONLY "public"."profile_share_invitations"
    ADD CONSTRAINT "profile_share_invitations_pkey" PRIMARY KEY ("id");
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.profile_share_invitations'::regclass AND conname='profile_share_invitations_invited_by_fkey') THEN
ALTER TABLE ONLY "public"."profile_share_invitations"
    ADD CONSTRAINT "profile_share_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");
END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.profile_share_invitations'::regclass AND conname='profile_share_invitations_profile_id_fkey') THEN
ALTER TABLE ONLY "public"."profile_share_invitations"
    ADD CONSTRAINT "profile_share_invitations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
END IF; END $$;

ALTER TABLE public.profile_share_invitations ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.profile_share_invitations TO authenticated;
GRANT ALL ON public.profile_share_invitations TO service_role;

CREATE OR REPLACE FUNCTION "public"."is_profile_member"("p_profile_id" "uuid", "p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET search_path = ''
    AS $$
  SELECT p_user_id=auth.uid() AND EXISTS (
    SELECT 1 FROM public.profile_members
    WHERE profile_id = p_profile_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION "public"."get_my_profiles"() RETURNS TABLE("id" "uuid", "uid" "uuid", "name" "text", "role" "text", "created_at" timestamp with time zone, "member_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Safety net: crea profilo e membership se mancano (es. trigger non ancora eseguito)
  INSERT INTO public.profiles (id, user_id, name)
  VALUES (v_uid, v_uid, 'Principale')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.profile_members (profile_id, user_id, role, email)
  SELECT p.id, p.user_id, 'owner', u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.user_id = v_uid
  ON CONFLICT (profile_id, user_id) DO NOTHING;

  RETURN QUERY
  SELECT
    p.id,
    p.user_id,           -- alias 'uid' in RETURNS TABLE → evita ambiguità con colonne omonime
    p.name,
    pm.role,
    p.created_at,
    (SELECT COUNT(*) FROM public.profile_members pm2 WHERE pm2.profile_id = p.id)
  FROM public.profiles p
  JOIN public.profile_members pm ON pm.profile_id = p.id AND pm.user_id = v_uid
  ORDER BY p.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."repair_own_membership"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET search_path = ''
    AS $$
BEGIN
  INSERT INTO public.profile_members (profile_id, user_id, role, email)
  SELECT p.id, p.user_id, 'owner', u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.user_id = auth.uid()
  ON CONFLICT (profile_id, user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET search_path = ''
    AS $$
BEGIN
  INSERT INTO public.profiles (id, user_id, name)
  VALUES (new.id, new.id, 'Principale');
  RETURN new;
END;
$$;

INSERT INTO public.profile_members(profile_id,user_id,role,email)
SELECT p.id,p.user_id,'owner',u.email FROM public.profiles p JOIN auth.users u ON u.id=p.user_id
ON CONFLICT(profile_id,user_id) DO NOTHING;
DROP POLICY IF EXISTS members_select ON public.profile_members;
CREATE POLICY members_select ON public.profile_members FOR SELECT TO authenticated USING(public.is_profile_member(profile_id,auth.uid()));
DROP POLICY IF EXISTS self_leave ON public.profile_members;
CREATE POLICY self_leave ON public.profile_members FOR DELETE TO authenticated USING(user_id=auth.uid() AND role<>'owner');
DROP POLICY IF EXISTS view_invitations ON public.profile_share_invitations;
CREATE POLICY view_invitations ON public.profile_share_invitations FOR SELECT TO authenticated USING(invited_by=auth.uid() OR lower(invited_email)=lower(auth.email()));

-- Legacy rows may predate profile_id. Repair only unambiguous original-owner links.
UPDATE public.accounts a SET profile_id=p.id FROM public.profiles p WHERE a.profile_id IS NULL AND p.id=a.user_id AND p.user_id=a.user_id;
UPDATE public.categories c SET profile_id=p.id FROM public.profiles p WHERE c.profile_id IS NULL AND p.id=c.user_id AND p.user_id=c.user_id;
UPDATE public.portfolios f SET profile_id=p.id FROM public.profiles p WHERE f.profile_id IS NULL AND p.id=f.user_id AND p.user_id=f.user_id;
UPDATE public.transactions t SET profile_id=a.profile_id FROM public.accounts a WHERE t.profile_id IS NULL AND t.account_id=a.id AND t.user_id=a.user_id AND a.profile_id IS NOT NULL;
UPDATE public.recurring_transactions r SET profile_id=a.profile_id FROM public.accounts a WHERE r.profile_id IS NULL AND r.account_id=a.id AND r.user_id=a.user_id AND a.profile_id IS NOT NULL;
UPDATE public.transfers t SET profile_id=a.profile_id FROM public.accounts a,public.accounts b WHERE t.profile_id IS NULL AND t.from_account_id=a.id AND t.to_account_id=b.id AND t.user_id=a.user_id AND t.user_id=b.user_id AND a.profile_id=b.profile_id AND a.profile_id IS NOT NULL;
