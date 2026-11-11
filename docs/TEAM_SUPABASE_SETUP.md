# Team Supabase Setup (leader onboarding)

One team leader owns a Supabase project and shares **only** the project URL and
the publishable (anon) key. Nobody ever shares the database password or the
`service_role` key. All access flows through `auth.uid()` + RLS + RPCs, so the
anon key is safe to distribute to teammates.

## 1. Create the Supabase project and users

1. Create a Supabase project (any region). Note the **Project URL** and the
   **anon publishable key** (Settings → API). These two strings are the only
   credentials teammates receive.
2. Authentication → Providers: enable Email (or any provider). Disable
   "Allow anonymous sign-ins" (Sign In/Up → Anonymous) so every identity is a
   real `auth.users` row.
3. Teammates each sign up in the app/CLI and read their own user UUID from
   their client (the SDK's `session.user.id`). They send that UUID to the
   leader out of band. The UUID alone grants nothing: membership only starts
   when the **leader** invites it (see §4), so UUID guessing or self-join is
   impossible — an unknown UUID fails `rev_unknown_user`, a known UUID gets
   rights only via a leader invite.

## 2. Deploy the schema (SQL editor)

Run, in order, the full contents of:

1. `supabase/migrations/0001_team_schema.sql`
2. `supabase/migrations/0002_rpc_api.sql`

Both are idempotent and repeatable (`create ... if not exists` /
`create or replace`); they never drop tables. Re-running them is always safe.
Verify after deploy:

```sql
select count(*) from pg_policies where schemaname = 'public';  -- >= 7
select proname from pg_proc where proname like 'rev_%';        -- 7 functions
```

## 3. Leader: create the team

The first authenticated call, made once by the leader:

```ts
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(PROJECT_URL, ANON_KEY); // with the leader's session
const { data, error } = await supabase.rpc('rev_create_team', {
  p_team_name: 'My Team',
});
// data = [{ team_id: '<uuid>', team_name: 'My Team' }]; save team_id.
```

The caller's `auth.uid()` becomes team owner — the single leader/admin.

## 4. Leader: invite teammates (manual onboarding)

For each teammate UUID the leader received (§1), leader runs:

```ts
await supabase.rpc('rev_invite_member', {
  p_team_id: TEAM_ID,
  p_member_user_id: '<teammate auth uuid>', // from the teammate, never guessed
  p_member_role: 'member',                  // or 'leader' (owner only)
});
```

Rules enforced server-side:

- leader-only: non-leaders get `42501 rev_forbidden_not_leader`;
- role must be `member` | `leader` (`22023 rev_invalid_role`);
- only the team **owner** may grant `leader` (`rev_only_owner_grants_leader`);
  at most one leader per team exists (DB trigger);
- re-inviting an existing member is an idempotent no-op returning the row.

There is deliberately **no RPC that lists `auth.users`** — the leader never
gets an arbitrary user directory.

## 5. RPC contract (exact)

All RPCs are PostgREST calls: `POST /rest/v1/rpc/<name>` with JSON args, or
`supabase.rpc(name, args)`. Errors surface as PostgREST errors with the Postgres
message string (e.g. `rev_forbidden_not_member`) and HTTP 403/400.
`project_key` is always the canonical repository identity hash — **never a
local path**.

### `rev_create_team(p_team_name text)`
- args: `{ p_team_name: string }` (1–120 chars after trim)
- returns: `team_id uuid, team_name text`
- caller becomes owner/leader. Errors: `rev_unauthenticated`,
  `rev_invalid_team_name`.

### `rev_invite_member(p_team_id uuid, p_member_user_id uuid, p_member_role text)`
- args: `{ p_team_id: uuid, p_member_user_id: uuid, p_member_role: 'member'|'leader' }`
- returns: `team_id uuid, member_user_id uuid, member_role text`
- leader-only, idempotent. Errors: `rev_forbidden_not_leader`,
  `rev_invalid_role`, `rev_only_owner_grants_leader`, `rev_unknown_user`.

### `rev_publish_document(p_team_id uuid, p_project_key text, p_kind text, p_doc_key text, p_expected_version bigint, p_payload jsonb, p_operation_id uuid)`
- args: `{ p_team_id: uuid, p_project_key: string, p_kind: 'analysis'|'handover',
  p_doc_key: string, p_expected_version: number, p_payload: object,
  p_operation_id?: uuid }`
- returns: `document_id uuid, version bigint, status text, operation_id uuid`
- `status`:
  - `committed` — appended as head (version = expected+1, or 1 on create with
    `p_expected_version` 0/null and no existing head);
  - `conflict` — stale write: the payload was **appended as an explicit
    rejected result** (`status='conflict'`, `conflict_of` → prior head).
    Nothing was overwritten. The client must persist both sides locally,
    re-merge, and re-publish with the fresh version.
- idempotency: pass a stable `p_operation_id` (UUIDv4 generated per logical
  write, kept until acknowledged). A retry with the same operation id, same
  user and team returns the original result without re-applying; replays
  across users/teams cannot collide.
- errors: `rev_unauthenticated`, `rev_forbidden_not_member`,
  `rev_invalid_kind`, `rev_invalid_project_key` (must match `^[a-f0-9]{8,128}$`),
  `rev_invalid_doc_key`, `rev_invalid_payload`,
  `rev_forbidden_not_owner` (non-leader superseding a handover they don't own),
  `rev_version_mismatch` (expected a version that doesn't exist).
- payload gates: ≤ 2 MB; no local filesystem paths or machine-identifier keys;
  handovers must carry `selected_sources` (non-empty array of
  reviewer-selected authorized source ids) and `reviewer_approved: true`.
  Raw unselected artifacts and local paths are rejected server-side.

### `rev_list_documents(p_team_id uuid, p_project_key text, p_kind text)`
- args: `{ p_team_id: uuid, p_project_key: string, p_kind?: 'analysis'|'handover' }`
- returns rows: `document_id uuid, project_key text, kind text, doc_key text,
  version bigint, created_by uuid, created_at timestamptz, status text,
  conflict_of uuid, payload jsonb`
- full history (all versions, latest first, including `conflict` rows) that the
  caller is authorized to read: analyses → all members; handovers → owner +
  leader only, on every version. Non-authorized rows are absent.
- the current head of a chain = first returned row with `status='committed'`.

## 6. What is protected (summary)

- Anonymous role has **no grants**; unauthenticated JWTs fail
  `rev_unauthenticated`; RLS adds defense in depth.
- Every read/write verifies membership (`rev_is_team_member`) — including
  conflict paths and operation replays. Cross-team access impossible.
- Writes happen only inside security-definer RPCs with fixed
  `search_path = pg_catalog, public`. Clients have no direct table
  insert/update/delete grants.
- Append-only history: no update/delete path exists for documents; conflicts
  are preserved as rejected rows, never overwriting committed data.
- Leader is unique per team; admin/owner cross-project power exists only
  inside their own team.
- Handover privacy: only the owner and the team leader can read or supersede
  handover versions, and the payload must be a reviewer-approved projection.

## 7. Local development / tests

`tests/team-remote-schema.test.ts` runs the two migration files against an
in-memory PGlite database and exercises the authorization matrix (anon vs
member vs leader vs cross-team, replay, conflicts, handover privacy). PGlite
lacks the `auth` schema, so the test creates a minimal `auth` shim (`auth.users`
table + `auth.uid()` from `request.jwt.claims`) before applying the migrations —
this mirrors the Supabase runtime contract without touching the network.
