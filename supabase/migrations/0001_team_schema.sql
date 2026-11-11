-- WIP ONLY: DO NOT DEPLOY. Local/remote authorization is not yet verified.
-- ReV Team Sync — initial team data + auth linkage schema.
--
-- Deploy order: 0001 then 0002. Repeatable/idempotent: safe to re-run.
-- NEVER drops tables or columns. Manual deployment only (leader's Supabase).
--
-- Model summary
--   rev_teams            one row per team; exactly one leader (owner)
--   rev_team_members     membership; leader-only invite; unique per user+team
--   rev_documents        shared committed-code analysis + handovers, append-only
--                        version history; conflicts recorded as rejected rows
--   rev_sync_operations  idempotency ledger (operation UUID -> result)
--
-- Identity comes from Supabase auth (auth.uid()). No direct table writes for
-- clients: everything goes through SECURITY DEFINER RPCs in 0002.
--
-- NOTE: this migration assumes the Supabase-provided `auth` schema exists
-- (it ships with every Supabase project). `auth.uid()` is used inside
-- security-definer functions only, never in a client-reachable path.

create schema if not exists public;

-- ---------------------------------------------------------------------------
-- rev_teams
-- ---------------------------------------------------------------------------
create table if not exists public.rev_teams (
  id          uuid primary key default gen_random_uuid(),
  team_name   text not null check (char_length(team_name) between 1 and 120),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

comment on table public.rev_teams is 'One row per team. owner_id is the single leader/admin.';

-- ---------------------------------------------------------------------------
-- rev_team_members
--   role: 'member' | 'leader'. At most one leader per team, enforced below.
--   member_user_id is accepted manually by the leader from the teammate's
--   authenticated Supabase UUID (shown in the teammate's client). Invites are
--   leader-only and cannot be self-service, so self-join is impossible.
-- ---------------------------------------------------------------------------
create table if not exists public.rev_team_members (
  team_id        uuid not null references public.rev_teams (id) on delete cascade,
  member_user_id uuid not null references auth.users (id) on delete cascade,
  member_role    text not null check (member_role in ('member', 'leader')),
  invited_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  primary key (team_id, member_user_id)
);

create index if not exists rev_team_members_user_idx
  on public.rev_team_members (member_user_id);

comment on table public.rev_team_members is 'Team membership. Leader role is unique per team. Invites are leader-only; the user UUID comes from the teammate''s authenticated client, never guessed.';

-- ---------------------------------------------------------------------------
-- rev_documents
--   Append-only shared document store. kind is restricted to
--   'analysis' | 'handover'. project_key is the canonical repository identity
--   hash (NOT a local path). Superseding rows never overwrite prior ones.
--   Rows with status='conflict' are explicit rejected results kept for full
--   history: the client that hit the conflict persists both sides locally and
--   records the rejected attempt here.
--   Handover visibility: owner + team leader only (handled by RPC + RLS).
-- ---------------------------------------------------------------------------
create table if not exists public.rev_documents (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.rev_teams (id) on delete cascade,
  project_key    text not null check (char_length(project_key) between 8 and 128),
  kind           text not null check (kind in ('analysis', 'handover')),
  doc_key        text not null check (char_length(doc_key) between 1 and 256),
  version        bigint not null default 1,
  payload        jsonb not null,
  payload_bytes  integer not null default 0,
  created_by     uuid not null references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  -- 'committed' = accepted publish; 'conflict' = rejected stale write kept
  -- as an explicit rejected result (client persists both sides locally).
  status         text not null default 'committed' check (status in ('committed', 'conflict')),
  conflict_of    uuid references public.rev_documents (id) on delete set null,
  operation_id   uuid not null
);

create unique index if not exists rev_documents_live_key_idx
  on public.rev_documents (team_id, project_key, kind, doc_key, version)
  where status = 'committed';

create index if not exists rev_documents_team_project_idx
  on public.rev_documents (team_id, project_key, kind);

create index if not exists rev_documents_operation_idx
  on public.rev_documents (operation_id);

comment on table public.rev_documents is 'Append-only version history for shared analysis and handovers. status=conflict rows are rejected attempts preserved for full history; committed rows are the accepted chain.';

-- ---------------------------------------------------------------------------
-- rev_sync_operations — idempotency ledger
--   One row per client operation UUID. Repeated publish with the same
--   operation_id returns the original result instead of creating a duplicate.
-- ---------------------------------------------------------------------------
create table if not exists public.rev_sync_operations (
  operation_id  uuid primary key,
  team_id       uuid not null references public.rev_teams (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('analysis', 'handover')),
  result        text not null check (result in ('committed', 'conflict')),
  document_id   uuid references public.rev_documents (id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.rev_sync_operations is 'Idempotency ledger: one entry per client operation UUID; retries replay the recorded result.';

-- ---------------------------------------------------------------------------
-- Helper: is the current auth.uid() a member (any role) of the team?
-- Stable signature used across migrations 0001 and 0002.
-- ---------------------------------------------------------------------------
create or replace function public.rev_is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.rev_team_members m
    where m.team_id = p_team_id
      and m.member_user_id = auth.uid()
  )
$$;

comment on function public.rev_is_team_member(uuid) is 'Membership check used by RLS and RPCs. SECURITY DEFINER with fixed search_path; reads membership regardless of caller grants.';

-- ---------------------------------------------------------------------------
-- Helper: is the current auth.uid() the leader (owner) of the team?
-- Owner of rev_teams OR a member row with member_role='leader' qualifies,
-- but there is exactly one leader per team (see 0002 trigger), so these
-- coincide. Cross-project admin access is allowed ONLY for the team leader.
-- ---------------------------------------------------------------------------
create or replace function public.rev_is_team_leader(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.rev_team_members m
    join public.rev_teams t on t.id = m.team_id
    where m.team_id = p_team_id
      and m.member_user_id = auth.uid()
      and (m.member_role = 'leader' or t.owner_id = auth.uid())
  )
$$;

comment on function public.rev_is_team_leader(uuid) is 'Leader check: admin/owner has cross-project rights only for their own team.';

-- ---------------------------------------------------------------------------
-- Stable chain ownership: the owner of a document chain is the creator of the
-- FIRST row ever inserted for (team, project, kind, doc) — across ALL
-- revisions and statuses. It never changes when a leader supersedes, so the
-- original owner keeps read/edit rights on every version and cannot be locked
-- out by later edits. Derived server-side, never trusted from the client.
-- ---------------------------------------------------------------------------
create or replace function public.rev_chain_owner(
  p_team_id uuid, p_project_key text, p_kind text, p_doc_key text
)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select d.created_by
  from public.rev_documents d
  where d.team_id = p_team_id
    and d.project_key = p_project_key
    and d.kind = p_kind
    and d.doc_key = p_doc_key
  order by d.version asc, d.created_at asc, d.id asc
  limit 1
$$;

comment on function public.rev_chain_owner(uuid, text, text, text) is 'Stable per-chain owner: creator of the first row across all revisions/statuses. Never changes on leader supersede.';

-- ---------------------------------------------------------------------------
-- Row visibility (used by BOTH the RLS policy and the RPCs so they can never
-- drift): analyses are shared with the whole team; handovers are readable by
-- the creator of that specific row, the stable chain owner, and the team
-- leader — on every version. Everyone else (including other members) gets
-- nothing.
-- ---------------------------------------------------------------------------
create or replace function public.rev_can_read_row(
  p_team_id uuid, p_project_key text, p_kind text, p_doc_key text, p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_team_id is not null
    and public.rev_is_team_member(p_team_id)
    and (
      p_kind = 'analysis'
      or p_created_by = auth.uid()
      or public.rev_chain_owner(p_team_id, p_project_key, p_kind, p_doc_key) = auth.uid()
      or public.rev_is_team_leader(p_team_id)
    )
$$;

comment on function public.rev_can_read_row(uuid, text, text, text, uuid) is 'Row visibility: analyses shared with team; handover versions restricted to row creator, stable chain owner, and leader. Shared by RLS and RPCs.';

-- ---------------------------------------------------------------------------
-- RLS: deny by default; authenticated-only via policies below.
-- The anon role gets NO grants at all (see 0002), so anonymous requests are
-- rejected before policies even apply. Policies are defense in depth.
-- ---------------------------------------------------------------------------
alter table public.rev_teams            enable row level security;
alter table public.rev_team_members     enable row level security;
alter table public.rev_documents        enable row level security;
alter table public.rev_sync_operations  enable row level security;

-- Teams: members see their teams; leader can create/see/update own team row.
drop policy if exists rev_teams_select on public.rev_teams;
create policy rev_teams_select on public.rev_teams
  for select to authenticated
  using (owner_id = auth.uid() or public.rev_is_team_member(id));

drop policy if exists rev_teams_insert on public.rev_teams;
create policy rev_teams_insert on public.rev_teams
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists rev_teams_update on public.rev_teams;
create policy rev_teams_update on public.rev_teams
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- No delete policy: teams are never deleted through the client.

-- Membership rows: members can read their team roster; only leader RPC can
-- insert (direct inserts denied by grants in 0002; policy kept for defense).
drop policy if exists rev_members_select on public.rev_team_members;
create policy rev_members_select on public.rev_team_members
  for select to authenticated
  using (member_user_id = auth.uid() or public.rev_is_team_member(team_id));

-- Documents: SELECT restricted per kind/ownership; no direct INSERT/UPDATE
-- policies for clients (all writes go through rev_publish_document RPC).
drop policy if exists rev_documents_select on public.rev_documents;
create policy rev_documents_select on public.rev_documents
  for select to authenticated
  using (public.rev_can_read_row(team_id, project_key, kind, doc_key, created_by));

-- Sync operations: users see their own operation ledger entries only.
drop policy if exists rev_sync_ops_select on public.rev_sync_operations;
create policy rev_sync_ops_select on public.rev_sync_operations
  for select to authenticated
  using (user_id = auth.uid());
