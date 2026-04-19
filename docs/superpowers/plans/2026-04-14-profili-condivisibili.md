# Profili Condivisibili Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere agli utenti Trackr di condividere un profilo con altri utenti esistenti, assegnando ruolo `editor` (lettura+scrittura) o `viewer` (sola lettura), con inviti in-app via email e controllo accessi applicato a livello RLS su Supabase.

**Architecture:** Nuove tabelle `profile_members` e `profile_share_invitations` su Supabase. RLS su tutte le tabelle dati migrata da `user_id = auth.uid()` a `is_profile_member(profile_id, auth.uid())` tramite funzione SECURITY DEFINER. Logica inviti interamente server-side tramite RPC per prevenire email enumeration. Frontend aggiornato per gestire profili condivisi in SettingsPage, notifiche inviti nella bell, e restrizioni UI per viewer.

**Tech Stack:** Supabase (PostgreSQL + RLS + PL/pgSQL RPC), React 18 + TypeScript, Vite, Tailwind CSS.

---

## File Map

| File | Azione | Responsabilità |
|------|--------|----------------|
| `supabase/shared_profiles_migration.sql` | Crea | Tutto il DDL: tabelle, helper fn, RLS, RPCs, backfill |
| `src/types/index.ts` | Modifica | Aggiunge ProfileRole, ProfileMember, ProfileInvitation; estende UserProfile |
| `src/services/api.ts` | Modifica | Aggiorna getProfiles(); aggiunge 8 nuovi metodi sharing |
| `src/contexts/DataContext.tsx` | Modifica | Aggiunge pendingInvitations state, azioni accept/reject/leave |
| `src/pages/SettingsPage.tsx` | Modifica | UI gestione membri inline, form invito, badge ruolo |
| `src/components/layout/Layout.tsx` | Modifica | Card inviti nel pannello notifiche, badge count aggiornato |

---

## Task 1: DB — Tabelle, helper functions, backfill

**Files:**
- Crea: `supabase/shared_profiles_migration.sql`

- [ ] **Step 1: Crea il file di migrazione con le nuove tabelle e le helper functions**

```sql
-- supabase/shared_profiles_migration.sql
-- ============================================================
-- PARTE 1: Nuove tabelle
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profile_members (
  profile_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text        NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  email       text,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.profile_share_invitations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_email text        NOT NULL,
  invited_by    uuid        NOT NULL REFERENCES auth.users(id),
  role          text        NOT NULL CHECK (role IN ('editor', 'viewer')),
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

-- Indici per query frequenti
CREATE INDEX IF NOT EXISTS profile_members_user_id_idx ON public.profile_members(user_id);
CREATE INDEX IF NOT EXISTS profile_share_invitations_email_idx ON public.profile_share_invitations(invited_email);
CREATE INDEX IF NOT EXISTS profile_share_invitations_status_idx ON public.profile_share_invitations(status);

-- ============================================================
-- PARTE 2: Helper functions (SECURITY DEFINER — bypassano RLS)
-- ============================================================

-- Verifica se un utente è membro di un profilo (qualsiasi ruolo)
CREATE OR REPLACE FUNCTION public.is_profile_member(p_profile_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_members
    WHERE profile_id = p_profile_id AND user_id = p_user_id
  );
$$;

-- Verifica se un utente è owner di un profilo
CREATE OR REPLACE FUNCTION public.is_profile_owner(p_profile_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_members
    WHERE profile_id = p_profile_id AND user_id = p_user_id AND role = 'owner'
  );
$$;

-- ============================================================
-- PARTE 3: Backfill — ogni profilo esistente ottiene il suo owner
-- ============================================================

INSERT INTO public.profile_members (profile_id, user_id, role, email)
SELECT
  p.id,
  p.user_id,
  'owner',
  u.email
FROM public.profiles p
JOIN auth.users u ON u.id = p.user_id
ON CONFLICT (profile_id, user_id) DO NOTHING;
```

- [ ] **Step 2: Esegui la PARTE 1, 2 e 3 nel Supabase SQL Editor**

Vai su Supabase Dashboard → SQL Editor → incolla ed esegui il contenuto del file.

Verifica con:
```sql
-- Deve mostrare le tabelle appena create
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('profile_members', 'profile_share_invitations');

-- Deve avere una riga per ogni profilo esistente con role = 'owner'
SELECT pm.role, p.name, u.email
FROM profile_members pm
JOIN profiles p ON p.id = pm.profile_id
JOIN auth.users u ON u.id = pm.user_id;
```

- [ ] **Step 3: Commit**

```bash
cd /home/lika44/Documenti/Python/trackr
git add supabase/shared_profiles_migration.sql
git commit -m "feat: add profile_members and profile_share_invitations tables with helper functions"
```

---

## Task 2: DB — Aggiornamento RLS

**Files:**
- Modifica: `supabase/shared_profiles_migration.sql` (aggiunge PARTE 4)

- [ ] **Step 1: Aggiungi la PARTE 4 (RLS) al file di migrazione**

```sql
-- ============================================================
-- PARTE 4: RLS aggiornata
-- ============================================================

-- Abilita RLS sulle nuove tabelle
ALTER TABLE public.profile_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_share_invitations ENABLE ROW LEVEL SECURITY;

-- ---- profile_members ----
-- Qualsiasi membro può vedere tutti i membri del profilo
CREATE POLICY "members_select" ON public.profile_members
  FOR SELECT USING (is_profile_member(profile_id, auth.uid()));

-- Solo owner può gestire i membri (aggiungere/rimuovere/modificare ruoli)
CREATE POLICY "owner_manage" ON public.profile_members
  FOR ALL USING (is_profile_owner(profile_id, auth.uid()));

-- Qualsiasi membro non-owner può eliminare solo se stesso (lasciare il profilo)
CREATE POLICY "self_leave" ON public.profile_members
  FOR DELETE USING (user_id = auth.uid() AND role != 'owner');

-- ---- profile_share_invitations ----
-- L'invitante vede i propri inviti; il destinatario vede gli inviti per la sua email
CREATE POLICY "view_invitations" ON public.profile_share_invitations
  FOR SELECT USING (
    invited_by = auth.uid()
    OR invited_email = auth.email()
  );

-- Solo owner del profilo può creare inviti (gestito nella RPC, questa è una safety net)
CREATE POLICY "owner_insert_invitation" ON public.profile_share_invitations
  FOR INSERT WITH CHECK (is_profile_owner(profile_id, auth.uid()));

-- Il mittente può annullare i propri inviti pending
CREATE POLICY "cancel_own_invitation" ON public.profile_share_invitations
  FOR UPDATE USING (invited_by = auth.uid() AND status = 'pending');

-- ---- profiles: aggiorna SELECT per mostrare anche i profili condivisi ----
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (
    -- profili propri o profili di cui si è membro
    user_id = auth.uid() OR is_profile_member(id, auth.uid())
  );

-- ---- Tabelle con profile_id: accounts, categories, portfolios,
--      recurring_transactions, transactions, transfers ----
-- Per ognuna: sostituisce la policy "own data" con member-based

-- ACCOUNTS
DROP POLICY IF EXISTS "own data" ON public.accounts;
CREATE POLICY "members_all" ON public.accounts
  USING (is_profile_member(profile_id, auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profile_members
            WHERE profile_id = accounts.profile_id
              AND user_id = auth.uid()
              AND role IN ('owner', 'editor'))
  );

-- CATEGORIES
DROP POLICY IF EXISTS "own data" ON public.categories;
CREATE POLICY "members_all" ON public.categories
  USING (is_profile_member(profile_id, auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profile_members
            WHERE profile_id = categories.profile_id
              AND user_id = auth.uid()
              AND role IN ('owner', 'editor'))
  );

-- PORTFOLIOS
DROP POLICY IF EXISTS "own data" ON public.portfolios;
CREATE POLICY "members_all" ON public.portfolios
  USING (is_profile_member(profile_id, auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profile_members
            WHERE profile_id = portfolios.profile_id
              AND user_id = auth.uid()
              AND role IN ('owner', 'editor'))
  );

-- TRANSACTIONS
DROP POLICY IF EXISTS "own data" ON public.transactions;
CREATE POLICY "members_all" ON public.transactions
  USING (is_profile_member(profile_id, auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profile_members
            WHERE profile_id = transactions.profile_id
              AND user_id = auth.uid()
              AND role IN ('owner', 'editor'))
  );

-- TRANSFERS
DROP POLICY IF EXISTS "Users can view own transfers" ON public.transfers;
DROP POLICY IF EXISTS "Users can insert own transfers" ON public.transfers;
DROP POLICY IF EXISTS "Users can update own transfers" ON public.transfers;
DROP POLICY IF EXISTS "Users can delete own transfers" ON public.transfers;
CREATE POLICY "members_all" ON public.transfers
  USING (is_profile_member(profile_id, auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profile_members
            WHERE profile_id = transfers.profile_id
              AND user_id = auth.uid()
              AND role IN ('owner', 'editor'))
  );

-- RECURRING_TRANSACTIONS
DROP POLICY IF EXISTS "Users manage own recurring" ON public.recurring_transactions;
CREATE POLICY "members_all" ON public.recurring_transactions
  USING (is_profile_member(profile_id, auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profile_members
            WHERE profile_id = recurring_transactions.profile_id
              AND user_id = auth.uid()
              AND role IN ('owner', 'editor'))
  );

-- SUBCATEGORIES: accesso via categoria (non ha profile_id diretto)
DROP POLICY IF EXISTS "own data" ON public.subcategories;
CREATE POLICY "members_all" ON public.subcategories
  USING (
    category_id IN (
      SELECT id FROM public.categories
      WHERE is_profile_member(profile_id, auth.uid())
    )
  )
  WITH CHECK (
    category_id IN (
      SELECT id FROM public.categories
      WHERE EXISTS (
        SELECT 1 FROM public.profile_members
        WHERE profile_id = categories.profile_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'editor')
      )
    )
  );

-- ORDERS: accesso via portfolio (non ha profile_id diretto)
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
DROP POLICY IF EXISTS "Users can insert own orders" ON public.orders;
DROP POLICY IF EXISTS "Users can update own orders" ON public.orders;
DROP POLICY IF EXISTS "Users can delete own orders" ON public.orders;
CREATE POLICY "members_all" ON public.orders
  USING (
    portfolio_id IN (
      SELECT id FROM public.portfolios
      WHERE is_profile_member(profile_id, auth.uid())
    )
  )
  WITH CHECK (
    portfolio_id IN (
      SELECT id FROM public.portfolios
      WHERE EXISTS (
        SELECT 1 FROM public.profile_members
        WHERE profile_id = portfolios.profile_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'editor')
      )
    )
  );
```

- [ ] **Step 2: Esegui la PARTE 4 nel Supabase SQL Editor**

Verifica che le policy siano state create:
```sql
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Verifica funzionale (come utente autenticato nel browser):
- Accedi all'app → Dashboard deve caricare normalmente
- Le transazioni e i conti devono ancora essere visibili

- [ ] **Step 3: Commit**

```bash
git add supabase/shared_profiles_migration.sql
git commit -m "feat: migrate RLS to profile_members-based access control"
```

---

## Task 3: DB — RPC server-side per inviti

**Files:**
- Modifica: `supabase/shared_profiles_migration.sql` (aggiunge PARTE 5)

- [ ] **Step 1: Aggiungi la PARTE 5 (RPCs) al file di migrazione**

```sql
-- ============================================================
-- PARTE 5: RPC server-side
-- ============================================================

-- Crea un invito. Non rivela mai se l'email esiste.
-- Rate limiting: max 10 inviti/ora per utente.
CREATE OR REPLACE FUNCTION public.create_profile_invitation(
  p_profile_id uuid,
  p_email      text,
  p_role       text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invited_user_id uuid;
  v_recent_count    int;
BEGIN
  -- Verifica che il chiamante sia owner del profilo
  IF NOT public.is_profile_owner(p_profile_id, auth.uid()) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  -- Rate limiting: max 10 inviti nell'ultima ora
  SELECT COUNT(*) INTO v_recent_count
  FROM public.profile_share_invitations
  WHERE invited_by = auth.uid()
    AND created_at > now() - interval '1 hour';

  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  -- Lookup email — risultato mai esposto al client (SECURITY DEFINER)
  SELECT id INTO v_invited_user_id FROM auth.users WHERE email = p_email LIMIT 1;

  -- Se l'utente non esiste: ritorna silenziosamente (anti-enumeration)
  IF v_invited_user_id IS NULL THEN RETURN; END IF;

  -- Già membro: blocca con errore visibile (non è una info sensibile)
  IF EXISTS (
    SELECT 1 FROM public.profile_members
    WHERE profile_id = p_profile_id AND user_id = v_invited_user_id
  ) THEN
    RAISE EXCEPTION 'already_member';
  END IF;

  -- Invito già pending: blocca
  IF EXISTS (
    SELECT 1 FROM public.profile_share_invitations
    WHERE profile_id = p_profile_id
      AND invited_email = p_email
      AND status = 'pending'
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'invite_pending';
  END IF;

  -- Crea invito
  INSERT INTO public.profile_share_invitations (profile_id, invited_email, invited_by, role)
  VALUES (p_profile_id, p_email, auth.uid(), p_role);
END;
$$;

-- Accetta un invito (atomico: status + membership in un'unica transazione)
CREATE OR REPLACE FUNCTION public.accept_profile_invitation(p_invitation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inv   public.profile_share_invitations%ROWTYPE;
  v_email text;
BEGIN
  SELECT * INTO v_inv
  FROM public.profile_share_invitations
  WHERE id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;

  IF v_inv.status != 'pending' OR v_inv.expires_at < now() THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;

  -- Verifica che il chiamante sia il destinatario
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS DISTINCT FROM v_inv.invited_email THEN
    RAISE EXCEPTION 'not_recipient';
  END IF;

  -- Crea membership
  INSERT INTO public.profile_members (profile_id, user_id, role, email)
  VALUES (v_inv.profile_id, auth.uid(), v_inv.role, v_email)
  ON CONFLICT (profile_id, user_id) DO NOTHING;

  -- Aggiorna status
  UPDATE public.profile_share_invitations
  SET status = 'accepted'
  WHERE id = p_invitation_id;
END;
$$;
```

- [ ] **Step 2: Esegui la PARTE 5 nel Supabase SQL Editor**

Verifica che le funzioni siano state create:
```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('create_profile_invitation', 'accept_profile_invitation',
                       'is_profile_member', 'is_profile_owner');
```

- [ ] **Step 3: Commit**

```bash
git add supabase/shared_profiles_migration.sql
git commit -m "feat: add create_profile_invitation and accept_profile_invitation RPCs"
```

---

## Task 4: TypeScript — Tipi

**Files:**
- Modifica: `src/types/index.ts`

- [ ] **Step 1: Aggiungi i nuovi tipi e aggiorna UserProfile**

In `src/types/index.ts`, trova l'interfaccia `UserProfile` (riga ~14) e sostituisci il blocco da `export interface UserProfile` fino alla riga vuota successiva con:

```typescript
export type ProfileRole = 'owner' | 'editor' | 'viewer';

export interface UserProfile {
  id: string;       // UUID (= auth.uid() per il profilo principale)
  user_id: string;  // FK a auth.users
  name: string;
  role: ProfileRole;  // 'owner' se è tuo, 'editor'/'viewer' se condiviso
  created_at?: string;
}

export interface ProfileMember {
  profile_id: string;
  user_id: string;
  role: ProfileRole;
  email?: string;   // copiata da auth.users al momento dell'accettazione
  joined_at: string;
}

export interface ProfileInvitation {
  id: string;
  profile_id: string;
  profile_name?: string;      // join client-side per display
  invited_by_email?: string;  // email del mittente (da invited_by join)
  role: 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  expires_at: string;
}
```

- [ ] **Step 2: Verifica che il progetto compili senza errori TypeScript**

```bash
cd /home/lika44/Documenti/Python/trackr
npm run build 2>&1 | head -40
```

Se ci sono errori su `UserProfile` (il campo `role` non esisteva prima), correggi i punti indicati dal compiler. I casi tipici:
- `mapProfile` in `api.ts` — aggiungi `role: row.role ?? 'owner'`
- `createUserProfile` — il profilo appena creato è sempre `owner`

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add ProfileRole, ProfileMember, ProfileInvitation types; extend UserProfile with role"
```

---

## Task 5: API Service — Metodi sharing

**Files:**
- Modifica: `src/services/api.ts`

- [ ] **Step 1: Aggiorna `getProfiles()` per includere `role`**

Trova il metodo `getProfiles()` in `api.ts` e sostituiscilo con:

```typescript
async getProfiles(): Promise<UserProfile[]> {
  const userId = await getCurrentUserId();
  // Legge le membership dell'utente e fa join sui profili
  const { data, error } = await supabase
    .from('profile_members')
    .select('role, email, profiles(*)')
    .eq('user_id', userId)
    .order('profiles(created_at)');
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row.profiles,
    role: row.role as ProfileRole,
  }));
}
```

- [ ] **Step 2: Aggiungi `getProfileMembers()`**

Dopo `getProfiles()`, aggiungi:

```typescript
async getProfileMembers(profileId: string): Promise<ProfileMember[]> {
  const { data, error } = await supabase
    .from('profile_members')
    .select('*')
    .eq('profile_id', profileId)
    .order('joined_at');
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 3: Aggiungi `inviteToProfile()`**

```typescript
async inviteToProfile(
  profileId: string,
  email: string,
  role: 'editor' | 'viewer'
): Promise<void> {
  // La RPC gestisce tutto server-side: lookup email, rate limiting, duplicati.
  // Non rivela se l'email esiste — ritorna sempre void.
  const { error } = await supabase.rpc('create_profile_invitation', {
    p_profile_id: profileId,
    p_email: email,
    p_role: role,
  });
  if (error) {
    // Errori "visibili" all'utente (non rivelano esistenza email)
    if (error.message.includes('already_member')) throw new Error('already_member');
    if (error.message.includes('invite_pending')) throw new Error('invite_pending');
    if (error.message.includes('rate_limited')) throw new Error('rate_limited');
    if (error.message.includes('not_owner')) throw new Error('not_owner');
    throw error;
  }
}
```

- [ ] **Step 4: Aggiungi `removeProfileMember()`, `cancelInvitation()`, `leaveProfile()`**

```typescript
async removeProfileMember(profileId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('profile_members')
    .delete()
    .eq('profile_id', profileId)
    .eq('user_id', userId);
  if (error) throw error;
}

async cancelInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase
    .from('profile_share_invitations')
    .update({ status: 'cancelled' })
    .eq('id', invitationId)
    .eq('status', 'pending');
  if (error) throw error;
}

async leaveProfile(profileId: string): Promise<void> {
  const userId = await getCurrentUserId();
  const { error } = await supabase
    .from('profile_members')
    .delete()
    .eq('profile_id', profileId)
    .eq('user_id', userId)
    .neq('role', 'owner');
  if (error) throw error;
}
```

- [ ] **Step 5: Aggiungi `getPendingInvitations()`, `acceptInvitation()`, `rejectInvitation()`**

```typescript
async getPendingInvitations(): Promise<ProfileInvitation[]> {
  const { data, error } = await supabase
    .from('profile_share_invitations')
    .select('*, profiles(name)')
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Recupera email del mittente per display
  return (data ?? []).map((row: any) => ({
    id: row.id,
    profile_id: row.profile_id,
    profile_name: row.profiles?.name ?? '',
    invited_by_email: row.invited_by,  // UUID — mostriamo solo il nome profilo in UI
    role: row.role,
    status: row.status,
    expires_at: row.expires_at,
  }));
}

async acceptInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('accept_profile_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) {
    if (error.message.includes('invalid_invitation')) throw new Error('invalid_invitation');
    if (error.message.includes('not_recipient')) throw new Error('not_recipient');
    throw error;
  }
}

async rejectInvitation(invitationId: string): Promise<void> {
  const { error } = await supabase
    .from('profile_share_invitations')
    .update({ status: 'rejected' })
    .eq('id', invitationId);
  if (error) throw error;
}
```

- [ ] **Step 6: Verifica compilazione**

```bash
npm run build 2>&1 | head -40
```

- [ ] **Step 7: Commit**

```bash
git add src/services/api.ts
git commit -m "feat: add profile sharing methods to apiService"
```

---

## Task 6: DataContext — State e azioni sharing

**Files:**
- Modifica: `src/contexts/DataContext.tsx`

- [ ] **Step 1: Aggiungi `pendingInvitations` all'interfaccia e allo state**

Nella sezione dell'interfaccia `DataContextType` (dopo `activeProfile: UserProfile | null;`), aggiungi:

```typescript
pendingInvitations: ProfileInvitation[];

// Sharing actions
acceptInvitation: (invitationId: string) => Promise<void>;
rejectInvitation: (invitationId: string) => Promise<void>;
leaveProfile: (profileId: string) => Promise<void>;
```

Nell'import di types, aggiungi `ProfileInvitation`.

Nel corpo del provider, dopo `const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);` aggiungi:

```typescript
const [pendingInvitations, setPendingInvitations] = useState<ProfileInvitation[]>([]);
```

- [ ] **Step 2: Carica gli inviti in `fetchAllData`**

Trova la funzione `fetchAllData` (o equivalente — la funzione che carica tutti i dati all'avvio). Dopo il caricamento dei profili (dopo la chiamata a `apiService.getProfiles()`), aggiungi:

```typescript
const invitations = await apiService.getPendingInvitations();
setPendingInvitations(invitations);
```

- [ ] **Step 3: Aggiungi le azioni sharing**

Nel corpo del provider, aggiungi queste funzioni:

```typescript
const acceptInvitation = async (invitationId: string) => {
  await apiService.acceptInvitation(invitationId);
  // Rimuovi l'invito dalla lista locale
  setPendingInvitations(prev => prev.filter(i => i.id !== invitationId));
  // Ricarica i profili (ora include il profilo condiviso appena accettato)
  const updatedProfiles = await apiService.getProfiles();
  setUserProfiles(updatedProfiles);
};

const rejectInvitation = async (invitationId: string) => {
  await apiService.rejectInvitation(invitationId);
  setPendingInvitations(prev => prev.filter(i => i.id !== invitationId));
};

const leaveProfile = async (profileId: string) => {
  await apiService.leaveProfile(profileId);
  const updatedProfiles = await apiService.getProfiles();
  setUserProfiles(updatedProfiles);
  // Se stava usando il profilo che ha lasciato, switcha al primo disponibile
  if (activeProfile?.id === profileId) {
    const next = updatedProfiles[0];
    if (next) await switchProfile(next);
  }
};
```

- [ ] **Step 4: Esponi nel return del context**

Nel return del provider (oggetto `value`), aggiungi:

```typescript
pendingInvitations,
acceptInvitation,
rejectInvitation,
leaveProfile,
```

- [ ] **Step 5: Verifica compilazione**

```bash
npm run build 2>&1 | head -40
```

- [ ] **Step 6: Commit**

```bash
git add src/contexts/DataContext.tsx
git commit -m "feat: add pendingInvitations state and sharing actions to DataContext"
```

---

## Task 7: SettingsPage — UI gestione membri

**Files:**
- Modifica: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Aggiungi import e state per la gestione membri**

In cima al file (dopo gli import esistenti), aggiungi all'import di `useData`:

```typescript
const {
  userProfiles, activeProfile, switchProfile,
  createUserProfile, updateUserProfile, deleteUserProfile,
  leaveProfile,    // nuovo
} = useData();
```

Aggiungi i nuovi campi di state (dopo gli state esistenti del profilo):

```typescript
const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
const [profileMembers, setProfileMembers] = useState<Record<string, ProfileMember[]>>({});
const [inviteEmail, setInviteEmail] = useState('');
const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
const [inviteLoading, setInviteLoading] = useState(false);
const [inviteMsg, setInviteMsg] = useState<string | null>(null);
```

Aggiungi gli import di tipi: `ProfileMember` da `'../types'`.

- [ ] **Step 2: Aggiungi la funzione per espandere i membri**

```typescript
const handleToggleMembers = async (profileId: string) => {
  if (expandedProfileId === profileId) {
    setExpandedProfileId(null);
    return;
  }
  setExpandedProfileId(profileId);
  if (!profileMembers[profileId]) {
    const members = await apiService.getProfileMembers(profileId);
    setProfileMembers(prev => ({ ...prev, [profileId]: members }));
  }
};
```

Aggiungi import di `apiService` se non già presente: `import { apiService } from '../services/api';`

- [ ] **Step 3: Aggiungi la funzione per invitare**

```typescript
const handleInvite = async (profileId: string) => {
  if (!inviteEmail.trim()) return;
  setInviteLoading(true);
  setInviteMsg(null);
  try {
    await apiService.inviteToProfile(profileId, inviteEmail.trim(), inviteRole);
    // Risposta sempre ambigua (anti-enumeration)
    setInviteMsg(t('settings.inviteSent'));
    setInviteEmail('');
  } catch (e: any) {
    if (e.message === 'already_member') setInviteMsg(t('settings.inviteErrorAlreadyMember'));
    else if (e.message === 'invite_pending') setInviteMsg(t('settings.inviteErrorPending'));
    else if (e.message === 'rate_limited') setInviteMsg(t('settings.inviteErrorRateLimit'));
    else setInviteMsg(t('settings.inviteError'));
  } finally {
    setInviteLoading(false);
  }
};
```

- [ ] **Step 4: Aggiungi `handleRemoveMember` e `handleLeaveProfile`**

```typescript
const handleRemoveMember = async (profileId: string, userId: string) => {
  const confirmed = await confirm(t('settings.confirmRemoveMember'));
  if (!confirmed) return;
  await apiService.removeProfileMember(profileId, userId);
  setProfileMembers(prev => ({
    ...prev,
    [profileId]: (prev[profileId] ?? []).filter(m => m.user_id !== userId),
  }));
};

const handleLeaveProfile = async (profileId: string) => {
  const confirmed = await confirm(t('settings.confirmLeaveProfile'));
  if (!confirmed) return;
  setProfileLoading(true);
  try {
    await leaveProfile(profileId);
    setExpandedProfileId(null);
  } catch {
    setProfileMsg({ type: 'error', text: t('settings.errorProfileDelete') });
  } finally {
    setProfileLoading(false);
  }
};
```

- [ ] **Step 5: Aggiorna il render della lista profili**

Nella sezione JSX dove vengono mappati i profili (`userProfiles.map(profile => ...)`), aggiorna ogni riga profilo. Sostituisci il blocco da `<div key={profile.id} className={...}` fino alla sua chiusura `</div>` con:

```tsx
<div key={profile.id} className={`rounded-xl border-2 transition-colors ${
  activeProfile?.id === profile.id
    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
    : 'border-gray-200 dark:border-gray-700'
}`}>
  {/* Riga principale profilo */}
  <div className="flex items-center gap-2 px-3 py-2.5">
    {editingProfileId === profile.id ? (
      <input
        className="flex-1 input-field text-sm"
        value={editingProfileName}
        onChange={e => setEditingProfileName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSaveProfileName(profile.id);
          if (e.key === 'Escape') setEditingProfileId(null);
        }}
        autoFocus
      />
    ) : (
      <button
        className="flex-1 text-left flex items-center gap-2"
        onClick={() => { if (activeProfile?.id !== profile.id) switchProfile(profile); }}
      >
        <span className="font-medium text-sm">{profile.name}</span>
        {activeProfile?.id === profile.id && (
          <span className="text-xs text-primary-500 font-normal">{t('settings.activeProfile')}</span>
        )}
        {profile.role !== 'owner' && (
          <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">
            {profile.role === 'editor' ? '✏️' : '👁️'} {t(`settings.role_${profile.role}`)}
          </span>
        )}
      </button>
    )}

    {editingProfileId === profile.id ? (
      <div className="flex gap-1">
        <button onClick={() => setEditingProfileId(null)} className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200">{t('common.cancel')}</button>
        <button onClick={() => handleSaveProfileName(profile.id)} disabled={profileLoading} className="text-xs px-2 py-1 rounded bg-primary-500 text-white">{t('common.save')}</button>
      </div>
    ) : (
      <div className="flex items-center gap-1">
        {profile.role === 'owner' && (
          <>
            <button
              onClick={() => { setEditingProfileId(profile.id); setEditingProfileName(profile.name); }}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
            >✏️</button>
            <button
              onClick={() => handleToggleMembers(profile.id)}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
              title={t('settings.manageMembers')}
            >👥</button>
          </>
        )}
        {profile.role !== 'owner' && (
          <button
            onClick={() => handleLeaveProfile(profile.id)}
            className="text-xs px-2 py-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
          >{t('settings.leaveProfile')}</button>
        )}
        {userProfiles.length > 1 && profile.role === 'owner' && (
          <button
            onClick={() => handleDeleteProfile(profile.id)}
            disabled={profileLoading}
            className="p-1.5 text-gray-400 hover:text-red-500 rounded"
          >🗑️</button>
        )}
      </div>
    )}
  </div>

  {/* Sezione membri espandibile (solo owner) */}
  {profile.role === 'owner' && expandedProfileId === profile.id && (
    <div className="border-t border-gray-100 dark:border-gray-700 px-3 pb-3 pt-2">
      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
        {t('settings.members')}
      </p>

      {/* Lista membri correnti */}
      {(profileMembers[profile.id] ?? []).map(member => (
        <div key={member.user_id} className="flex items-center gap-2 mb-1.5">
          <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center text-xs font-semibold text-primary-600 dark:text-primary-400">
            {(member.email ?? '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{member.email ?? member.user_id}</p>
            <p className="text-xs text-gray-400">{t(`settings.role_${member.role}`)}</p>
          </div>
          {member.role !== 'owner' && (
            <button
              onClick={() => handleRemoveMember(profile.id, member.user_id)}
              className="text-xs text-red-400 hover:text-red-600 px-1"
            >{t('settings.remove')}</button>
          )}
        </div>
      ))}

      {/* Form invito */}
      {inviteMsg && (
        <p className="text-xs text-primary-600 dark:text-primary-400 mb-2">{inviteMsg}</p>
      )}
      <div className="flex gap-1.5 mt-2">
        <input
          className="flex-1 input-field text-sm"
          placeholder={t('settings.inviteEmailPlaceholder')}
          value={inviteEmail}
          onChange={e => { setInviteEmail(e.target.value); setInviteMsg(null); }}
          onKeyDown={e => { if (e.key === 'Enter') handleInvite(profile.id); }}
          type="email"
        />
        <select
          className="input-field text-sm w-auto px-2"
          value={inviteRole}
          onChange={e => setInviteRole(e.target.value as 'editor' | 'viewer')}
        >
          <option value="editor">{t('settings.role_editor')}</option>
          <option value="viewer">{t('settings.role_viewer')}</option>
        </select>
        <button
          onClick={() => handleInvite(profile.id)}
          disabled={inviteLoading || !inviteEmail.trim()}
          className="btn-primary text-sm px-3"
        >{t('settings.invite')}</button>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 6: Aggiungi le chiavi i18n mancanti**

In `src/locales/it.json`, nella sezione `settings`, aggiungi:

```json
"manageMembers": "Gestisci membri",
"members": "Membri",
"invite": "Invita",
"inviteEmailPlaceholder": "email@esempio.com",
"inviteSent": "Se questo indirizzo è registrato su Trackr, riceverà un invito a breve.",
"inviteErrorAlreadyMember": "Questo utente è già membro del profilo.",
"inviteErrorPending": "Esiste già un invito in attesa per questa email.",
"inviteErrorRateLimit": "Troppi inviti inviati. Riprova tra un'ora.",
"inviteError": "Errore durante l'invio dell'invito.",
"remove": "Rimuovi",
"leaveProfile": "Lascia profilo",
"confirmRemoveMember": "Rimuovere questo membro dal profilo?",
"confirmLeaveProfile": "Lasciare questo profilo condiviso?",
"role_owner": "owner",
"role_editor": "editor",
"role_viewer": "viewer"
```

In `src/locales/en.json`, nella sezione `settings`, aggiungi:

```json
"manageMembers": "Manage members",
"members": "Members",
"invite": "Invite",
"inviteEmailPlaceholder": "email@example.com",
"inviteSent": "If this address is registered on Trackr, they will receive an invitation shortly.",
"inviteErrorAlreadyMember": "This user is already a member of this profile.",
"inviteErrorPending": "There is already a pending invitation for this email.",
"inviteErrorRateLimit": "Too many invitations sent. Try again in an hour.",
"inviteError": "Error sending the invitation.",
"remove": "Remove",
"leaveProfile": "Leave profile",
"confirmRemoveMember": "Remove this member from the profile?",
"confirmLeaveProfile": "Leave this shared profile?",
"role_owner": "owner",
"role_editor": "editor",
"role_viewer": "viewer"
```

- [ ] **Step 7: Verifica compilazione e test manuale**

```bash
npm run build 2>&1 | head -40
npm run dev
```

Apri http://localhost:5174 → Settings → Profili:
- Tap su 👥 deve espandere la sezione membri
- La lista deve mostrare te stesso come "owner"
- Il form invito deve essere visibile

- [ ] **Step 8: Commit**

```bash
git add src/pages/SettingsPage.tsx src/locales/it.json src/locales/en.json
git commit -m "feat: add member management UI to SettingsPage"
```

---

## Task 8: Layout — Notifiche inviti

**Files:**
- Modifica: `src/components/layout/Layout.tsx`

- [ ] **Step 1: Aggiungi `pendingInvitations` dal DataContext**

In `Layout.tsx`, trova dove viene fatto `useData()` (cerca `const {` seguito da dati del contesto). Aggiungi `pendingInvitations, acceptInvitation, rejectInvitation` all'destructuring.

Aggiungi import del tipo `ProfileInvitation` da `'../../types'` se non già presente.

- [ ] **Step 2: Aggiorna il badge della bell**

Trova il codice che calcola il numero sul badge della bell notifiche (cerca il numero di reminder o il badge rosso). Aggiorna il conteggio:

```typescript
const totalNotifications = reminderCount + pendingInvitations.length;
// Usa totalNotifications al posto di reminderCount per il badge
```

(Il nome esatto della variabile `reminderCount` potrebbe differire — adatta al codice esistente.)

- [ ] **Step 3: Aggiungi le card inviti nel pannello notifiche**

Trova il punto nel JSX dove vengono renderizzate le notifiche nel pannello (il div che appare quando si clicca la bell). Prima delle notifiche esistenti, aggiungi:

```tsx
{pendingInvitations.map(inv => (
  <div
    key={inv.id}
    className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-3 mb-2"
  >
    <div className="flex items-start gap-2">
      <span className="text-lg mt-0.5">👥</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          {t('notifications.profileInviteTitle')}
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 mb-2">
          {t('notifications.profileInviteBody', {
            profileName: inv.profile_name ?? '',
            role: t(`settings.role_${inv.role}`),
          })}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => acceptInvitation(inv.id)}
            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg font-semibold"
          >{t('notifications.accept')}</button>
          <button
            onClick={() => rejectInvitation(inv.id)}
            className="text-xs px-3 py-1.5 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg border border-gray-200 dark:border-gray-600"
          >{t('notifications.reject')}</button>
        </div>
      </div>
    </div>
  </div>
))}
```

- [ ] **Step 4: Aggiungi le chiavi i18n per le notifiche**

In `src/locales/it.json`, nella sezione `notifications`, aggiungi:

```json
"profileInviteTitle": "Invito profilo condiviso",
"profileInviteBody": "Sei stato invitato a collaborare su \"{{profileName}}\" come {{role}}",
"accept": "Accetta",
"reject": "Rifiuta"
```

In `src/locales/en.json`:

```json
"profileInviteTitle": "Shared profile invitation",
"profileInviteBody": "You've been invited to collaborate on \"{{profileName}}\" as {{role}}",
"accept": "Accept",
"reject": "Reject"
```

- [ ] **Step 5: Verifica**

```bash
npm run build 2>&1 | head -40
npm run dev
```

Test manuale: crea un invito da un account, accedi con un secondo account (browser privato), verifica che la bell mostri il badge e la card invito.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/Layout.tsx src/locales/it.json src/locales/en.json
git commit -m "feat: show profile invitations in notification bell"
```

---

## Task 9: Viewer restriction

**Files:**
- Modifica: `src/components/layout/Layout.tsx`
- Modifica: `src/pages/TransactionsPage.tsx`, `src/pages/AccountsPage.tsx`, `src/pages/CategoriesPage.tsx`

- [ ] **Step 1: Banner viewer in Layout**

In `Layout.tsx`, dopo l'import di `useData`, aggiungi `activeProfile` all'destructuring.

Nel JSX, subito dopo il tag `<main` di apertura (prima del `{children}`), aggiungi:

```tsx
{activeProfile?.role === 'viewer' && (
  <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
    <span>👁️</span>
    <span>{t('layout.viewerBanner')}</span>
  </div>
)}
```

Aggiungi chiave i18n:
- `it.json`: `"viewerBanner": "Stai visualizzando questo profilo in sola lettura"`
- `en.json`: `"viewerBanner": "You are viewing this profile in read-only mode"`

- [ ] **Step 2: Disabilita bottoni di scrittura per viewer**

In ogni pagina con azioni di scrittura, aggiungi il check del ruolo. Il pattern è lo stesso per tutte:

**`TransactionsPage.tsx`** — trova il bottone/riga di aggiunta transazioni e aggiungi la condizione:

```tsx
// Aggiungi vicino agli altri hook:
const { activeProfile } = useData();
const isViewer = activeProfile?.role === 'viewer';

// Sul bottone/tile di aggiunta:
// Aggiungi `hidden={isViewer}` o `className={isViewer ? 'hidden' : ''}`
```

**`AccountsPage.tsx`** e **`CategoriesPage.tsx`**: stesso pattern — aggiungi `isViewer` e nascondi i controlli di aggiunta/modifica/eliminazione.

La bottom row con "+" in tutte le pagine lista va nascosta con `{!isViewer && <riga aggiunta />}`.

- [ ] **Step 3: Verifica**

```bash
npm run dev
```

Test manuale:
1. Accedi con un account che è `viewer` di un profilo condiviso
2. Switcha a quel profilo
3. Verifica: banner giallo visibile, bottoni di aggiunta/modifica assenti
4. Verifica che i dati siano visibili (lettura funziona)
5. Verifica (in Supabase Dashboard → Table Editor) che tentare un INSERT diretto come viewer sia bloccato dalla RLS

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Layout.tsx src/pages/TransactionsPage.tsx src/pages/AccountsPage.tsx src/pages/CategoriesPage.tsx src/locales/it.json src/locales/en.json
git commit -m "feat: add viewer read-only banner and disable write actions for viewer role"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Tabelle `profile_members` e `profile_share_invitations` → Task 1
- ✅ Funzione helper `is_profile_member` + `is_profile_owner` → Task 1
- ✅ Backfill owner esistenti → Task 1
- ✅ RLS aggiornata su tutte le tabelle dati + profiles + nuove tabelle → Task 2
- ✅ `create_profile_invitation` (anti-enumeration, rate-limiting) → Task 3
- ✅ `accept_profile_invitation` (atomico) → Task 3
- ✅ Tipi TypeScript → Task 4
- ✅ `getProfiles()` aggiornato con role → Task 5
- ✅ Tutti i metodi API sharing → Task 5
- ✅ DataContext con `pendingInvitations` + azioni → Task 6
- ✅ SettingsPage UI inline con form invito + lista membri → Task 7
- ✅ i18n per tutte le nuove stringhe → Task 7 + 8
- ✅ Bell notifiche con card inviti + badge aggiornato → Task 8
- ✅ Viewer banner + disabilitazione UI → Task 9
- ✅ `leaveProfile` → Task 6 (DataContext) + Task 7 (SettingsPage)
- ✅ Edge cases (invito a se stessi bloccato lato client, già membro, invito duplicato) → Task 5 (`inviteToProfile` error handling)

**Placeholder scan:** Nessun TBD o placeholder trovato.

**Type consistency:** `ProfileRole`, `ProfileMember`, `ProfileInvitation` definiti in Task 4 e usati consistentemente nei Task 5, 6, 7, 8. `acceptInvitation`/`rejectInvitation`/`leaveProfile` definiti in Task 5, esposti in Task 6, usati in Task 7 e 8.
