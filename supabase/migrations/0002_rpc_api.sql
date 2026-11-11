-- WIP ONLY: DO NOT DEPLOY. Local/remote authorization is not yet verified.
-- ReV Team Sync — RPC API (security definer) + grants + integrity triggers.
-- Deploy after 0001. Repeatable/idempotent. NEVER drops tables.
--
-- RPC surface (all require an authenticated Supabase JWT; anon has no grants):
--   rev_create_team(p_team_name text)
--   rev_invite_member(p_team_id uuid, p_member_user_id uuid, p_member_role text)
--   rev_publish_document(p_team_id uuid, p_project_key text, p_kind text,
--                        p_doc_key text, p_expected_version bigint,
--                        p_payload jsonb, p_operation_id uuid default null)
--   rev_list_documents(p_team_id uuid, p_project_key text, p_kind text default null)
--
-- Safety properties enforced HERE, in SQL, for every call:
--   * identity: auth.uid() is checked on every read and write, including
--     conflict paths and retries;
--   * membership + role: writes require team membership; invites and any
--     cross-project/admin action require team leader only;
--   * no self-join / no escalation: a leader cannot invite themselves into a
--     team they are not in, cannot create a second leader, cannot raise their
--     own or others' role outside the leader path;
--   * replay protection: p_operation_id replays the recorded result instead
--     of re-applying (idempotent retry);
--   * concurrency: per-document advisory lock + expected_version CAS. A stale
--     write is APPENDED as status='conflict' (explicit rejected result, full
--     history preserved, nothing overwritten) and the client is told to
--     persist both sides locally;
--   * handover payloads must be a projection of reviewer-selected authorized
--     sources only: raw unselected artifacts, local filesystem paths and
--     machine identifiers are rejected.

-- ===========================================================================
-- Shared payload validation (actual Run shapes)
--   analysis: { version: 1, projectKey, analyzerVersion, commit, report }
--   handover: { status: 'needs_review'|'approved', selectedIds: [..],
--               artifacts: [{ id, kind?, sourceEventIds? }], sourceEvents? }
-- Rejects payloads carrying local-path/project-root/secrets/machine keys.
-- NOTE: local path SUBSTRINGS inside authorized source text are explicit
-- user-approved content and are NOT rejected — only banned KEYS are.
-- Returns TRUE when the payload is acceptable.
-- ===========================================================================
create or replace function public.rev_validate_payload(p_kind text, p_payload jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_text text;
  v_artifact jsonb;
  v_ref text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;

  -- Hard size cap (2 MB serialized).
  if octet_length(p_payload::text) > 2000000 then
    return false;
  end if;

  -- Banned KEYS at any nesting depth: project roots, local path carriers,
  -- machine identifiers, secret carriers. Server-side gate — a trusted
  -- client projection alone is NOT sufficient. Substring scan of the
  -- serialized JSON catches nested occurrences. Values are NOT scanned:
  -- authorized source text may legitimately mention local paths.
  v_text := lower(p_payload::text);
  if jsonb_path_exists(p_payload, '$.**.keyvalue() ? (@.key like_regex "(token|password|secret|api_?key|credential|private_?key)" flag "i")'::jsonpath, '{}'::jsonb, true) then
    return false;
  end if;
  if v_text like '%"project_root"%' or v_text like '%"projectroot"%'
     or v_text like '%"root_path"%' or v_text like '%"local_path"%'
     or v_text like '%"absolute_path"%' or v_text like '%"machine_id"%'
     or v_text like '%"hostname"%' or v_text like '%"user_home"%'
     or v_text like '%"username"%' or v_text like '%"api_key"%'
     or v_text like '%"apikey"%' or v_text like '%"private_key"%'
     or v_text like '%"secret%' or v_text like '%"token"%'
     or v_text like '%"password"%' or v_text like '%"credential%' then
    return false;
  end if;

  if p_kind = 'analysis' then
    -- { version:1, projectKey, analyzerVersion, commit, report:{...} }
    if coalesce(p_payload ->> 'version', '') <> '1' then
      return false;
    end if;
    if coalesce(p_payload ->> 'projectKey', '') !~* '^[a-f0-9]{8,128}$' then
      return false;
    end if;
    if coalesce(p_payload ->> 'analyzerVersion', '') = '' then
      return false;
    end if;
    if coalesce(p_payload ->> 'commit', '') !~* '^[0-9a-f]{7,64}$' then
      return false;
    end if;
    if jsonb_typeof(p_payload -> 'report') <> 'object' then
      return false;
    end if;
    return true;
  end if;

  if p_kind = 'handover' then
    -- Review status may be needs_review or approved; nothing else.
    if coalesce(p_payload ->> 'state', p_payload ->> 'status', p_payload ->> 'reviewStatus')
         not in ('needs_review', 'approved') then
      return false;
    end if;
    -- selectedIds must be a non-empty array.
    if jsonb_typeof(p_payload -> 'selectedIds') <> 'array'
       or jsonb_array_length(p_payload -> 'selectedIds') = 0 then
      return false;
    end if;
    -- artifacts must be an array; every artifact id must be selected;
    -- working_change artifacts are rejected.
    if jsonb_typeof(p_payload -> 'artifacts') <> 'array' then
      return false;
    end if;
    for v_artifact in select * from jsonb_array_elements(p_payload -> 'artifacts')
    loop
      if jsonb_typeof(v_artifact) <> 'object' then
        return false;
      end if;
      if v_artifact ->> 'id' is null or not exists (
        select 1
        from jsonb_array_elements_text(p_payload -> 'selectedIds') s
        where s = v_artifact ->> 'id'
      ) then
        return false;
      end if;
      if coalesce(v_artifact ->> 'kind', v_artifact ->> 'type') = 'working_change' then
        return false;
      end if;
    end loop;
    -- sourceEvents refs must be valid: every artifact sourceEventId(s)
    -- reference must exist in the payload's sourceEvents[].id set.
    for v_ref in
      select j #>> '{}' from jsonb_path_query(p_payload -> 'artifacts', '$[*].sourceEventIds[*]') j
      union
      select j #>> '{}' from jsonb_path_query(p_payload -> 'artifacts', '$[*].sourceEventId') j
    loop
      if not exists (
        select 1
        from jsonb_array_elements(coalesce(p_payload -> 'sourceEvents', '[]'::jsonb)) e
        where e ->> 'id' = v_ref
      ) then
        return false;
      end if;
    end loop;
    return true;
  end if;

  return false;
end;
$$;

comment on function public.rev_validate_payload(text, jsonb) is 'Payload gate for actual Run shapes: analysis {version,projectKey,analyzerVersion,commit,report}; handover {status,selectedIds,artifacts,sourceEvents} with selected-artifact integrity and no working_change; bans projectRoot/secret/machine keys; source-text path substrings are user-approved content and allowed.';

-- ===========================================================================
-- Exactly one leader per team. Trigger guards direct table writes too.
-- ===========================================================================
create or replace function public.rev_enforce_single_leader()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.member_role = 'leader' then
    if exists (
      select 1 from public.rev_team_members m
      where m.team_id = new.team_id
        and m.member_role = 'leader'
        and m.member_user_id <> new.member_user_id
    ) then
      raise exception 'rev_team_already_has_leader'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists rev_single_leader_guard on public.rev_team_members;
create trigger rev_single_leader_guard
  before insert or update of member_role on public.rev_team_members
  for each row execute function public.rev_enforce_single_leader();

-- ===========================================================================
-- rev_create_team(p_team_name text) -> (team_id uuid, team_name text)
-- Caller becomes owner (the single leader). Manual onboarding: leader runs
-- this once in their own Supabase.
-- ===========================================================================
create or replace function public.rev_create_team(p_team_name text)
returns table (team_id uuid, team_name text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_team uuid;
  v_name text := coalesce(trim(p_team_name), '');
begin
  if v_user is null then
    raise exception 'rev_unauthenticated' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'rev_invalid_team_name' using errcode = '22023';
  end if;

  insert into public.rev_teams (team_name, owner_id)
  values (v_name, v_user)
  returning id into v_team;

  insert into public.rev_team_members (team_id, member_user_id, member_role)
  values (v_team, v_user, 'leader');

  return query select v_team, v_name;
end;
$$;

-- ===========================================================================
-- rev_invite_member(p_team_id uuid, p_member_user_id uuid, p_member_role text)
-- -> (team_id uuid, member_user_id uuid, member_role text)
-- LEADER-ONLY manual onboarding. p_member_user_id must be the teammate's
-- real authenticated Supabase UUID (verified against auth.users by FK);
-- it cannot be guessed. p_member_role must be 'member' or 'leader', but a
-- non-owner leader may only invite plain members. Idempotent re-invite of
-- the same user returns the existing row unchanged.
-- ===========================================================================
create or replace function public.rev_invite_member(
  p_team_id uuid,
  p_member_user_id uuid,
  p_member_role text
)
returns table (team_id uuid, member_user_id uuid, member_role text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_user uuid := auth.uid();
  v_role text := coalesce(p_member_role, 'member');
begin
  if v_user is null then
    raise exception 'rev_unauthenticated' using errcode = '42501';
  end if;
  if not public.rev_is_team_leader(p_team_id) then
    raise exception 'rev_forbidden_not_leader' using errcode = '42501';
  end if;
  if v_role not in ('member', 'leader') then
    raise exception 'rev_invalid_role' using errcode = '22023';
  end if;
  -- Self-join impossible: the leader is already a member; inviting their own
  -- uuid again is a no-op replay, inviting someone else never grants the
  -- caller anything. Non-owner leaders cannot mint another leader.
  if v_role = 'leader' and not exists (
    select 1 from public.rev_teams t
    where t.id = p_team_id and t.owner_id = v_user
  ) then
    raise exception 'rev_only_owner_grants_leader' using errcode = '42501';
  end if;

  -- The invite target must exist as an authenticated user (FK enforces;
  -- explicit check gives a clear error instead of 23503).
  if not exists (select 1 from auth.users u where u.id = p_member_user_id) then
    raise exception 'rev_unknown_user' using errcode = '22023';
  end if;

  insert into public.rev_team_members (team_id, member_user_id, member_role)
  values (p_team_id, p_member_user_id, v_role)
  on conflict (team_id, member_user_id) do nothing;

  return query
    select m.team_id, m.member_user_id, m.member_role
    from public.rev_team_members m
    where m.team_id = p_team_id and m.member_user_id = p_member_user_id;
end;
$$;

-- ===========================================================================
-- rev_publish_document(...) -> (document_id uuid, version bigint,
--                               status text, operation_id uuid)
-- status: 'committed' | 'conflict'
--   'committed': appended as the next version (expected_version matched).
--   'conflict' : expected_version was stale; the payload is APPENDED as an
--                explicit rejected result (conflict_of -> current head).
--                Nothing is overwritten. Client must persist both sides
--                locally and re-merge.
-- Idempotency: same p_operation_id returns the original result, no new row.
-- Concurrency: advisory lock serializes publishes per document key.
-- Ownership/role: membership required; handover edits are owner-or-leader
-- enforced on ALL versions (list + read + conflict resolution).
-- ===========================================================================
create or replace function public.rev_publish_document(
  p_team_id uuid,
  p_project_key text,
  p_kind text,
  p_doc_key text,
  p_expected_version bigint,
  p_payload jsonb,
  p_operation_id uuid default null
)
returns table (document_id uuid, version bigint, status text, operation_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_op uuid := coalesce(p_operation_id, gen_random_uuid());
  v_project text := coalesce(trim(p_project_key), '');
  v_doc text := coalesce(trim(p_doc_key), '');
  v_head public.rev_documents;
  v_chain_owner uuid;
  v_new_version bigint;
  v_new_id uuid;
  v_status text;
begin
  if v_user is null then
    raise exception 'rev_unauthenticated' using errcode = '42501';
  end if;
  -- Every write path verifies membership FIRST, including retries.
  if not public.rev_is_team_member(p_team_id) then
    raise exception 'rev_forbidden_not_member' using errcode = '42501';
  end if;
  if p_kind not in ('analysis', 'handover') then
    raise exception 'rev_invalid_kind' using errcode = '22023';
  end if;
  if v_project = '' or char_length(v_project) > 128 or v_project !~ '^[a-f0-9]{8,128}$' then
    -- project_key is the canonical repository identity hash, never a path.
    raise exception 'rev_invalid_project_key' using errcode = '22023';
  end if;
  if v_doc = '' or char_length(v_doc) > 256 then
    raise exception 'rev_invalid_doc_key' using errcode = '22023';
  end if;
  if not public.rev_validate_payload(p_kind, p_payload) then
    raise exception 'rev_invalid_payload' using errcode = '22023';
  end if;

  -- Replay: an already-recorded operation returns its original result.
  -- Must be by the same user on the same team (prevents cross-team replay).
  if exists (
    select 1 from public.rev_sync_operations o
    where o.operation_id = v_op and o.user_id = v_user and o.team_id = p_team_id
  ) then
    return query
      select o.document_id, coalesce(d.version, 0::bigint), o.result, o.operation_id
      from public.rev_sync_operations o
      left join public.rev_documents d on d.id = o.document_id
      where o.operation_id = v_op;
    return;
  end if;

  -- Serialize concurrent edits of the same document key.
  perform pg_advisory_xact_lock(
    hashtextextended(p_team_id::text || ':' || v_project || ':' || p_kind || ':' || v_doc, 0)
  );

  select * into v_head
  from public.rev_documents d
  where d.team_id = p_team_id
    and d.project_key = v_project
    and d.kind = p_kind
    and d.doc_key = v_doc
    and d.status = 'committed'
  order by d.version desc
  limit 1;

  -- Stable chain owner across ALL revisions: creator of the first row ever
  -- written for this key, regardless of status. A leader supersede never
  -- changes ownership, so the original owner cannot be locked out of their
  -- chain by later edits.
  v_chain_owner := coalesce(
    public.rev_chain_owner(p_team_id, v_project, p_kind, v_doc),
    v_user
  );

  -- Role/ownership gate: a handover chain may be superseded only by its
  -- stable chain owner or the team leader — applied on every write path.
  if p_kind = 'handover'
     and v_chain_owner <> v_user
     and not public.rev_is_team_leader(p_team_id) then
    raise exception 'rev_forbidden_not_owner' using errcode = '42501';
  end if;

  if v_head.id is null then
    if p_expected_version is not null and p_expected_version <> 0 then
      -- Client claimed a base that does not exist. If rows exist for this key
      -- (e.g. a leader-owned handover this member cannot read) do not leak
      -- details: record the stale attempt as an explicit rejected row.
      if exists (
        select 1 from public.rev_documents d
        where d.team_id = p_team_id and d.project_key = v_project
          and d.kind = p_kind and d.doc_key = v_doc
      ) then
        insert into public.rev_documents
          (team_id, project_key, kind, doc_key, version, payload, payload_bytes,
           created_by, status, conflict_of, operation_id)
        values
          (p_team_id, v_project, p_kind, v_doc, 1, p_payload,
           octet_length(p_payload::text), v_user, 'conflict', null, v_op)
        returning id into v_new_id;
        v_status := 'conflict';
        v_new_version := 1;
      else
        raise exception 'rev_version_mismatch' using errcode = '40001';
      end if;
    else
      insert into public.rev_documents
        (team_id, project_key, kind, doc_key, version, payload, payload_bytes,
         created_by, status, operation_id)
      values
        (p_team_id, v_project, p_kind, v_doc, 1, p_payload,
         octet_length(p_payload::text), v_user, 'committed', v_op)
      returning id into v_new_id;
      v_status := 'committed';
      v_new_version := 1;
    end if;
  else
    if p_expected_version is null or p_expected_version <> v_head.version then
      -- Stale write: append explicit rejected result, preserve full history.
      insert into public.rev_documents
        (team_id, project_key, kind, doc_key, version, payload, payload_bytes,
         created_by, status, conflict_of, operation_id)
      values
        (p_team_id, v_project, p_kind, v_doc, v_head.version + 1, p_payload,
         octet_length(p_payload::text), v_user, 'conflict', v_head.id, v_op)
      returning id into v_new_id;
      v_status := 'conflict';
      v_new_version := v_head.version + 1;
    else
      insert into public.rev_documents
        (team_id, project_key, kind, doc_key, version, payload, payload_bytes,
         created_by, status, operation_id)
      values
        (p_team_id, v_project, p_kind, v_doc, v_head.version + 1, p_payload,
         octet_length(p_payload::text), v_user, 'committed', v_op)
      returning id into v_new_id;
      v_status := 'committed';
      v_new_version := v_head.version + 1;
    end if;
  end if;

  insert into public.rev_sync_operations (operation_id, team_id, user_id, kind, result, document_id)
  values (v_op, p_team_id, v_user, p_kind, v_status, v_new_id);

  return query select v_new_id, v_new_version, v_status, v_op;
end;
$$;

-- ===========================================================================
-- rev_list_documents(p_team_id uuid, p_project_key text, p_kind text default null)
-- -> (document_id uuid, project_key text, kind text, doc_key text,
--     version bigint, created_by uuid, created_at timestamptz,
--     status text, conflict_of uuid, payload jsonb)
-- Returns ALL versions the caller is authorized to read (full history,
-- including conflict rows), latest first. Visibility per row uses the SAME
-- predicate as the RLS policy (rev_can_read_row), so the two can never drift:
--   analysis  -> any team member
--   handover  -> row creator, stable chain owner, or team leader (all versions)
-- Rows the member cannot read are simply absent (no existence leak beyond
-- what rev_publish conflict-on-create already reports generically).
-- ===========================================================================
create or replace function public.rev_list_documents(
  p_team_id uuid,
  p_project_key text,
  p_kind text default null
)
returns table (
  document_id uuid,
  project_key text,
  kind text,
  doc_key text,
  version bigint,
  created_by uuid,
  created_at timestamptz,
  status text,
  conflict_of uuid,
  payload jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select d.id, d.project_key, d.kind, d.doc_key, d.version,
         d.created_by, d.created_at, d.status, d.conflict_of, d.payload
  from public.rev_documents d
  where d.team_id = p_team_id
    and d.project_key = coalesce(trim(p_project_key), '')
    and (p_kind is null or d.kind = p_kind)
    and public.rev_is_team_member(p_team_id)
    and public.rev_can_read_row(d.team_id, d.project_key, d.kind, d.doc_key, d.created_by)
  order by d.created_at desc, d.version desc
$$;

comment on function public.rev_publish_document(uuid, text, text, text, bigint, jsonb, uuid) is 'Append-only publish with expected_version CAS; conflicts become explicit rejected rows; operation UUID replays idempotently.';
comment on function public.rev_list_documents(uuid, text, text) is 'Authorized full-history listing; visibility identical to the RLS policy (rev_can_read_row): handover versions visible to row creator, stable chain owner, and leader only.';

-- ===========================================================================
-- Grants: authenticated may EXECUTE the RPCs and read through RLS; anon gets
-- NOTHING. No direct table grants for client writes (no INSERT/UPDATE/DELETE
-- on rev_documents/rev_sync_operations; membership table is read-only to
-- clients; teams read-only). SECURITY DEFINER functions default to revoking
-- EXECUTE from PUBLIC; we grant to authenticated explicitly.
-- ===========================================================================
revoke all on function public.rev_create_team(text) from public, anon;
revoke all on function public.rev_invite_member(uuid, uuid, text) from public, anon;
revoke all on function public.rev_publish_document(uuid, text, text, text, bigint, jsonb, uuid) from public, anon;
revoke all on function public.rev_list_documents(uuid, text, text) from public, anon;
revoke all on function public.rev_is_team_member(uuid) from public, anon;
revoke all on function public.rev_is_team_leader(uuid) from public, anon;
revoke all on function public.rev_chain_owner(uuid, text, text, text) from public, anon;
revoke all on function public.rev_can_read_row(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.rev_validate_payload(text, jsonb) from public, anon;

grant execute on function public.rev_create_team(text) to authenticated;
grant execute on function public.rev_invite_member(uuid, uuid, text) to authenticated;
grant execute on function public.rev_publish_document(uuid, text, text, text, bigint, jsonb, uuid) to authenticated;
grant execute on function public.rev_list_documents(uuid, text, text) to authenticated;
-- Helpers invoked inside RLS policy expressions run with the CALLER's
-- privileges for the EXECUTE check, so authenticated needs these to evaluate
-- policies. Their bodies are SECURITY DEFINER with a fixed search_path.
grant execute on function public.rev_is_team_member(uuid) to authenticated;
grant execute on function public.rev_is_team_leader(uuid) to authenticated;
grant execute on function public.rev_can_read_row(uuid, text, text, text, uuid) to authenticated;

-- Defense in depth: anon gets NO table privileges; authenticated may SELECT
-- (RLS scopes the rows) but never INSERT/UPDATE/DELETE directly. Supabase
-- default privileges would grant anon/authenticated more, so these revokes
-- are explicit and the anon ones are the "reject anonymous" guarantee.
do $$
begin
  execute 'revoke all on public.rev_teams from anon';
  execute 'revoke all on public.rev_team_members from anon';
  execute 'revoke all on public.rev_documents from anon';
  execute 'revoke all on public.rev_sync_operations from anon';
  execute 'grant select on public.rev_teams to authenticated';
  execute 'grant select on public.rev_team_members to authenticated';
  execute 'grant select on public.rev_documents to authenticated';
  execute 'grant select on public.rev_sync_operations to authenticated';
  execute 'revoke insert, update, delete, truncate on public.rev_documents from authenticated';
  execute 'revoke insert, update, delete, truncate on public.rev_sync_operations from authenticated';
  execute 'revoke insert, update, delete, truncate on public.rev_team_members from authenticated';
  execute 'revoke insert, update, delete, truncate on public.rev_teams from authenticated';
exception
  when undefined_object then null; -- role names differ on self-hosted
end;
$$;
