# Profili Condivisibili — Design Spec

**Data**: 2026-04-14  
**Progetto**: Trackr PWA  
**Stato**: Approvato, pronto per implementazione

---

## Sommario

Aggiunta del supporto alla condivisione di profili tra utenti Trackr esistenti. Un owner può invitare qualsiasi altro utente registrato assegnandogli il ruolo `editor` (lettura + scrittura) o `viewer` (sola lettura). Il controllo accessi è applicato a livello RLS su Supabase.

---

## 1. Schema DB

### Nuove tabelle

```sql
-- Membership: chi ha accesso a quale profilo e con quale ruolo
CREATE TABLE profile_members (
  profile_id  uuid  REFERENCES profiles(id) ON DELETE CASCADE,
  user_id     uuid  REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text  NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  email       text,           -- copiata da auth.users al momento dell'accettazione, per display
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, user_id)
);

-- Inviti in attesa di risposta
CREATE TABLE profile_share_invitations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invited_email text        NOT NULL,
  invited_by    uuid        NOT NULL REFERENCES auth.users(id),
  role          text        NOT NULL CHECK (role IN ('editor', 'viewer')),
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
```

### Migration backfill

Al deploy, ogni riga esistente in `profiles` genera una riga in `profile_members` con `role = 'owner'`:

```sql
INSERT INTO profile_members (profile_id, user_id, role)
SELECT id, user_id, 'owner' FROM profiles
ON CONFLICT DO NOTHING;
```

### Funzione helper RLS

```sql
CREATE OR REPLACE FUNCTION is_profile_member(p_profile_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM profile_members
    WHERE profile_id = p_profile_id AND user_id = p_user_id
  );
$$;
```

### Aggiornamento RLS (tutte le tabelle con `profile_id`)

Tabelle coinvolte: `accounts`, `categories`, `subcategories`, `transactions`, `transfers`, `portfolios`, `orders`, `recurring_transactions`.

```sql
-- Lettura: tutti i membri (owner + editor + viewer)
DROP POLICY IF EXISTS "..." ON <table>;
CREATE POLICY "members_select" ON <table>
  FOR SELECT USING (is_profile_member(profile_id, auth.uid()));

-- Scrittura: solo owner e editor
CREATE POLICY "members_write" ON <table>
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profile_members
      WHERE profile_id = <table>.profile_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'editor')
    )
  );
CREATE POLICY "members_update" ON <table>
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profile_members
      WHERE profile_id = <table>.profile_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'editor')
    )
  );
CREATE POLICY "members_delete" ON <table>
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profile_members
      WHERE profile_id = <table>.profile_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'editor')
    )
  );
```

### RLS su `profile_members` e `profile_share_invitations`

```sql
-- profile_members: visibile ai membri del profilo
CREATE POLICY "view_own_memberships" ON profile_members
  FOR SELECT USING (user_id = auth.uid() OR is_profile_member(profile_id, auth.uid()));

-- Solo owner può aggiungere/rimuovere membri
CREATE POLICY "owner_manage_members" ON profile_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profile_members pm
      WHERE pm.profile_id = profile_members.profile_id
        AND pm.user_id = auth.uid()
        AND pm.role = 'owner'
    )
  );

-- profile_share_invitations: owner del profilo vede gli inviti inviati;
-- il destinatario vede gli inviti che lo riguardano.
-- auth.email() legge l'email dal JWT claims — nessun accesso a auth.users necessario.
CREATE POLICY "view_invitations" ON profile_share_invitations
  FOR SELECT USING (
    invited_by = auth.uid()
    OR invited_email = auth.email()
  );
```

### RPC server-side per inviti (anti-enumeration)

La logica di invito è interamente server-side per evitare che qualsiasi client possa fare email enumeration chiamando una RPC esposta:

```sql
-- Crea un invito. Non rivela mai se l'email esiste o meno.
-- Rate limiting integrato: max 10 inviti/ora per utente.
CREATE OR REPLACE FUNCTION create_profile_invitation(
  p_profile_id uuid,
  p_email      text,
  p_role       text   -- 'editor' | 'viewer'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_invited_user_id uuid;
  v_recent_count    int;
BEGIN
  -- Verifica che il chiamante sia owner del profilo
  IF NOT EXISTS (
    SELECT 1 FROM profile_members
    WHERE profile_id = p_profile_id AND user_id = auth.uid() AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'not_owner';
  END IF;

  -- Rate limiting: max 10 inviti inviati nell'ultima ora
  SELECT COUNT(*) INTO v_recent_count
  FROM profile_share_invitations
  WHERE invited_by = auth.uid() AND created_at > now() - interval '1 hour';

  IF v_recent_count >= 10 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  -- Lookup email (interno, mai esposto al client)
  SELECT id INTO v_invited_user_id FROM auth.users WHERE email = p_email LIMIT 1;

  -- Se l'utente non esiste: esce silenziosamente (nessun errore)
  IF v_invited_user_id IS NULL THEN RETURN; END IF;

  -- Controlla duplicati (già membro o invito pending)
  IF EXISTS (SELECT 1 FROM profile_members WHERE profile_id = p_profile_id AND user_id = v_invited_user_id) THEN
    RAISE EXCEPTION 'already_member';
  END IF;
  IF EXISTS (
    SELECT 1 FROM profile_share_invitations
    WHERE profile_id = p_profile_id AND invited_email = p_email AND status = 'pending' AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'invite_pending';
  END IF;

  -- Crea invito
  INSERT INTO profile_share_invitations (profile_id, invited_email, invited_by, role)
  VALUES (p_profile_id, p_email, auth.uid(), p_role);
END;
$$;

-- Accetta un invito (atomico: aggiorna status + crea membro in un'unica transazione)
CREATE OR REPLACE FUNCTION accept_profile_invitation(p_invitation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inv profile_share_invitations%ROWTYPE;
  v_caller_email text;
BEGIN
  SELECT * INTO v_inv FROM profile_share_invitations WHERE id = p_invitation_id;

  -- Verifica che l'invito esista, sia pending e non scaduto
  IF NOT FOUND OR v_inv.status != 'pending' OR v_inv.expires_at < now() THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;

  -- Verifica che il chiamante sia il destinatario
  SELECT email INTO v_caller_email FROM auth.users WHERE id = auth.uid();
  IF v_caller_email != v_inv.invited_email THEN
    RAISE EXCEPTION 'not_recipient';
  END IF;

  -- Crea membership (salva email per display)
  INSERT INTO profile_members (profile_id, user_id, role, email)
  VALUES (v_inv.profile_id, auth.uid(), v_inv.role, v_caller_email)
  ON CONFLICT DO NOTHING;

  -- Aggiorna status
  UPDATE profile_share_invitations SET status = 'accepted' WHERE id = p_invitation_id;
END;
$$;
```

Queste RPC hanno `SECURITY DEFINER` e non restituiscono mai dati sull'esistenza di un'email: `create_profile_invitation` ritorna `void` sia che l'utente esista sia che non esista.

---

## 2. Flusso inviti

### Invio (mittente)

1. In `SettingsPage`, sezione Profili: tap su 👥 espande i membri del profilo inline
2. Form con campo email + selector ruolo (`editor` / `viewer`) + bottone "Invita"
3. `apiService.inviteToProfile(profileId, email, role)` chiama la RPC `create_profile_invitation(profileId, email, role)`
4. **Risposta UI sempre uguale**: "Se questo indirizzo è registrato su Trackr, riceverà un invito a breve."
5. Rate limiting gestito internamente dalla RPC (max 10 inviti/ora)

**Sicurezza — email enumeration:** tutta la logica è nella RPC server-side `create_profile_invitation` che ritorna `void` in ogni caso. Il client non riceve mai informazioni sull'esistenza o meno di un'email. Anche chiamando la RPC direttamente, non si ottiene nulla di utile.

### Ricezione (destinatario)

1. Al caricamento dell'app, `DataContext.fetchAllData` carica gli inviti `pending` non scaduti
2. Se ci sono inviti pendenti, il badge della bell notifiche mostra il conteggio totale (inviti + reminder ricorrenti)
3. Nel pannello notifiche, gli inviti appaiono mescolati alle altre notifiche con card distinte (sfondo indigo, icona 👥)
4. Ogni card mostra: nome profilo, email invitante, ruolo proposto, scadenza
5. Bottoni: **Accetta** / **Rifiuta**

### Accettazione

`apiService.acceptInvitation(invitationId)` chiama la RPC `accept_profile_invitation(invitationId)`:
1. Verifica che l'invito sia `pending`, non scaduto e destinato al chiamante
2. In una singola transazione: crea riga in `profile_members` + aggiorna `status = 'accepted'`
3. Il profilo condiviso compare immediatamente nella lista profili (DataContext aggiorna `userProfiles`)

### Rifiuto / Annullamento

- Rifiuto (destinatario): `status = 'rejected'`, nessuna riga in `profile_members`
- Annullamento (mittente): `status = 'cancelled'`, rimuove l'invito dalla lista

### Abbandono profilo condiviso (membro)

Un membro (`editor` o `viewer`) può lasciare un profilo condiviso da SettingsPage:
- `apiService.leaveProfile(profileId)` → DELETE da `profile_members` su se stesso
- Il profilo scompare dalla sua lista profili
- I dati da lui creati rimangono nel profilo

---

## 3. Frontend — Modifiche al codice

### `src/types/index.ts`

```typescript
type ProfileRole = 'owner' | 'editor' | 'viewer';

// UserProfile esteso
interface UserProfile {
  id: string;
  user_id: string;
  name: string;
  role: ProfileRole;      // nuovo
  created_at?: string;
}

interface ProfileMember {
  profile_id: string;
  user_id: string;
  role: ProfileRole;
  email?: string;         // copiata al momento dell'accettazione dalla RPC, presente in DB
  joined_at: string;
}

interface ProfileInvitation {
  id: string;
  profile_id: string;
  profile_name?: string;      // join per display lato destinatario
  invited_by_email?: string;  // join per display
  role: 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  expires_at: string;
}
```

### `src/services/api.ts`

Nuovi metodi:

```typescript
// Gestione membri (solo owner)
getProfileMembers(profileId: string): Promise<ProfileMember[]>
inviteToProfile(profileId: string, email: string, role: 'editor' | 'viewer'): Promise<void>
removeProfileMember(profileId: string, userId: string): Promise<void>
cancelInvitation(invitationId: string): Promise<void>
leaveProfile(profileId: string): Promise<void>

// Inviti ricevuti (utente corrente)
getPendingInvitations(): Promise<ProfileInvitation[]>
acceptInvitation(invitationId: string): Promise<void>
rejectInvitation(invitationId: string): Promise<void>
```

`getProfiles()` aggiornato per fare join su `profile_members` e includere il campo `role`.

### `src/contexts/DataContext.tsx`

- Aggiungere `pendingInvitations: ProfileInvitation[]` nello state
- Caricare gli inviti in `fetchAllData` (dopo il fetch dei profili)
- Esporre `acceptInvitation`, `rejectInvitation` come action
- Al cambio profilo, `pf_summaries_cache` già rimossa dal meccanismo esistente

### `src/pages/SettingsPage.tsx`

Sezione Profili — aggiornamenti:
- Bottone 👥 su ogni profilo espande la sezione membri inline
- Sezione espansa: lista membri con ruolo + bottone "Rimuovi" (solo per owner)
- Inviti pendenti in attesa di risposta mostrati con stato "⏳ in attesa" e bottone "Annulla"
- Form invito: input email + selector ruolo + bottone "Invita" con risposta ambigua
- Profili condivisi (role ≠ 'owner') mostrano badge ruolo + bottone "Lascia profilo" al posto di 👥

### `src/components/layout/Layout.tsx`

- Caricare `pendingInvitations` da DataContext
- Badge della bell: `reminderCount + pendingInvitations.length`
- Nel pannello notifiche: render delle card invito (con design distinto) sopra i reminder

### Viewer restriction

Componenti con azioni di scrittura (TransactionForm, AccountsPage bottom row, CategoriesPage, ecc.):
- Controllare `activeProfile?.role === 'viewer'`
- Nascondere o disabilitare i bottoni di creazione/modifica/eliminazione
- Banner sottile in Layout: "Stai visualizzando il profilo in sola lettura" quando `role === 'viewer'`

---

## 4. Edge cases

### Inviti
- **Email non trovata**: risposta sempre positiva (anti-enumeration); riga non creata
- **Invito scaduto**: ignorato silenziosamente se accettato in ritardo; mostrato come "scaduto" nell'UI se ancora visibile
- **Invito a se stessi**: bloccato lato client (`invited_email !== currentUser.email`)
- **Già membro**: bloccato con messaggio "già membro di questo profilo"
- **Invito duplicato**: bloccato se esiste già un `pending` per quella email sullo stesso profilo

### Permessi
- **Viewer tenta scrittura diretta** (bypass client): bloccato da RLS
- **Editor tenta di gestire i membri**: non esposto in UI; bloccato da RLS su `profile_members`
- **Owner non può abbandonare il proprio profilo**: il profilo principale (`id = user_id`) non è eliminabile (già gestito da RLS esistente)
- **Membro può lasciare autonomamente**: DELETE su `profile_members` per il proprio `user_id`

### Profilo condiviso nell'UI
- Badge "condiviso" + ruolo nella lista profili
- Nessun 👥 per owner diversi dal proprio account
- Al cambio verso profilo condiviso: `pf_summaries_cache` rimossa (già gestito)

### Cancellazione account owner
- Profilo e tutti i dati eliminati in cascade (`ON DELETE CASCADE`)
- I membri perdono accesso automaticamente

---

## 5. Decisioni escluse (YAGNI)

- Limite massimo di membri per profilo: non imposto
- Trasferimento ownership: non implementato (owner resta sempre il creatore)
- Notifiche push/email per inviti: solo in-app
- Ruoli granulari (es. "può vedere transazioni ma non portafogli"): non implementati
- Invito tramite link: non implementato (solo per email)
