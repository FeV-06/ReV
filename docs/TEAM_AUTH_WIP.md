# ReV authenticated team mode — implementation contract (WIP)

This document describes the next implementation slice, not a claim that team mode is production ready.

## Identity boundaries

- The browser and VS Code extension must prove a distinct user identity to the local daemon for each session; a loopback daemon bearer token authorizes the local client process only and never identifies a team member.
- A Supabase access token is verified by Supabase Auth; unverified JWT claims, form role selectors, and browser storage are not identity.
- The user session belongs to one team and one verified user. Team membership and lead/member role are obtained from the RLS-protected membership table using that user's provider token. Membership failures and provider outages fail closed for team access.
- Provider credentials must remain server-side and must not be copied into webviews, localStorage, URLs, logs, or run payloads. Browser sessions use random opaque HttpOnly, SameSite=Strict cookies bound to the loopback origin; non-browser clients use per-user opaque credentials stored with OS/VS Code secret storage, never daemon master tokens.
- Session expiration, logout, account switching, revocation, and process restart invalidate access. Never authorize against a process-global last-user session.

## Storage and authorization

- New team-mode runs are atomically created with a verified owner and team ID; default visibility is private. Missing owner rows represent legacy local data, not permission to claim them.
- Owner can read, edit, share, and delete own runs. A verified team lead can read/edit a run only after its owner shares it with the lead; another member or other-team user cannot read it. Only the owner can change sharing or delete.
- Every run identifier route (`GET`, `PATCH`, `POST ask`, `DELETE`, graph, export, refresh) must enforce the same server-side owner/team policy. Collection routes must filter before returning metadata. Per-run selected source projections do not replace identity checks.
- Store private and shared versions without overwriting unsynced local changes. A team-shared projection must not delete local-only sources, previously approved revisions, or provenance events.
- Existing desktop data is never implicitly assigned to a new account or altered. Migration/import of legacy records must be explicit and backup-preserving.

## Required integration and verification

1. Wire verified session issuance and refresh/logout into daemon routes; bind web cookies and extension host capabilities to the requesting user, with strict origin and CSRF checks.
2. Thread the verified identity through dashboard API proxy and extension host for all protected operations. Block any direct unauthenticated daemon route that touches team data; do not retain a direct in-process fallback around auth checks.
3. Replace demo persona sign-in in team mode; separately expose a clearly labeled local demo mode with no remote private-data access.
4. Wire `createOwnedRun`, `listOwnedRunIds`, `authorizeOwnedRun`, and visibility mutations into the real lifecycle. Make authorization and data reads/writes transactional or recheck inside the same mutation transaction to avoid revocation races.
5. Verify owner/member/lead/outsider using isolated real HTTP routes and SQL, not only helper tests; exercise wrong user, other team, revoked member, expired/logged-out sessions, direct endpoint access, cross-session and workspace switching.
6. Enable team sync only after the above and real Supabase/RLS tests pass. Keep migration and bulk-export gates closed until then.
