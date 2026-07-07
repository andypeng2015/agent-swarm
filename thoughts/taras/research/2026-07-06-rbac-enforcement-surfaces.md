---
date: 2026-07-06T00:00:00Z
researcher: Claude
git_commit: 9015e5befc34692b64725bdc9591a27868466385
branch: main
repository: desplega-ai/agent-swarm
topic: "RBAC enforcement surfaces — codebase-as-is map for DES-445"
tags: [research, rbac, auth, security, enforcement, isLead, principals]
status: complete
last_updated: 2026-07-06
last_updated_by: Claude
related_brainstorm: thoughts/taras/brainstorms/2026-05-15-rbac-for-swarm.md
related_research:
  - "agent-fs: research/2026-06-01-rbac-memory-options.md (RBAC × Memory v2, settled)"
  - "agent-fs: research/2026-06-05-sso-integration-design.md (RBAC-first sequencing)"
---

# RBAC enforcement surfaces — codebase-as-is map (DES-445)

## Research Question

Map the current agent-swarm codebase state across every surface the RBAC v1 design
(the 12 settled decisions in `2026-05-15-rbac-for-swarm.md`) needs before planning, and
close the brainstorm's 3 open questions. Document what IS — no redesign.

## Summary

The swarm has **no general RBAC engine**, but the *substrate the brainstorm assumed it
would have to build* is further along than the May-15 recon believed:

1. **HTTP enforcement-by-construction is viable.** There is exactly **one** production HTTP
   listener and **nothing bypasses the `handleCore` auth gate**. A `permissions:[]` field on
   the `route()` factory would cover the entire ~288-route surface. (Closes open Q1.)
2. **MCP tools also funnel through one factory** (`createToolRegistrar`, 114/114 tools) — a
   second enforcement-by-construction point. No per-tool permission field exists *yet*, but
   there is a single place to add one.
3. **`isLead`-as-authz is 34 inline sites, no central helper** — this is the concrete
   migration target for a `can()` / `requireRole()`.
4. **A partial *user* RBAC is ALREADY LIVE** and load-bearing: `requestedByUserId` drives
   task-ownership denials (`assertOwnsTask`, self-described "RBAC chokepoint"), user-scoped
   task listing, and per-user budget admission. This is the single biggest correction to the
   May-15 brainstorm, which treated `requestedByUserId` as attribution-only.
5. **The settled RBAC × Memory design is NOT merged.** Memory is still the pre-existing
   agent/swarm two-tier model with an `isLead` *bypass* — which contradicts the memory
   design's "leads get requester perms, no bypass" decision.
6. **`users.role` / UI `UserRole` / `minRole` are inert scaffolding** — read nowhere for an
   in-swarm access decision. (Closes open Q on scaffolding.)

---

## 1. HTTP enforcement chokepoint (closes Open Q1: "does anything bypass `route()`?")

**Answer: No handler bypasses the auth gate. Enforcement-by-construction is viable.**

- **One production listener:** `createHttpServer(async (req, res) => …)` at `src/http/index.ts:192`.
  Every other `Bun.serve`/`createServer` in the tree is under `src/tests/`. `src/http.ts` just
  imports `./http/index`; `src/server.ts` builds the *MCP tool server* (not HTTP); `src/stdio.ts`
  is stdio-only.
- **`handleCore` is the single bearer gate** — `src/http/core.ts:197-442`, invoked first and
  unconditionally at `src/http/index.ts:281`, before the fixed `handlers[]` array (49 handlers,
  `index.ts:288-337`). Auth block at `core.ts:244-260`: non-public paths → `resolveHttpRequestAuth`
  (`src/http/auth.ts:13-31`); `null` → `401` + `return`. Handler never reached.
- **`route()` registers, `handleCore` enforces** — `src/http/route-def.ts:148-206` pushes each
  def into a module-global `routeRegistry` (`:62`). `route()` does *not* itself check auth; it
  records `auth?: { apiKey?: boolean; agentId?: boolean }` metadata (`route-def.ts:31-34`) that
  `handleCore` reads via `isPublicRoute()` (`route-def.ts:70-81`). Unknown paths **fail closed**.
- **~288 `route({…})` call-sites across ~48 files** under `src/http/`. Heaviest: `workflows.ts`
  (18), `skills.ts` (17), `scripts.ts` (15), `users.ts`/`tasks.ts`/`memory.ts`/`agents.ts` (12 each).
- **20 intentional `apiKey:false` public routes** — webhook receivers (`webhooks.ts`: github/gitlab/
  agentmail/kapso), tracker OAuth+webhooks (`trackers/jira.ts`, `trackers/linear.ts`),
  `mcp-oauth.ts` callback, `workflows.ts` webhook trigger, `x.ts` script endpoint, public pages
  (`pages-public.ts`), page-proxy (`page-proxy.ts`, registered purely so `isPublicRoute` skips the
  bearer check). All still pass through `handleCore`; each does its own downstream signature/token
  verification. **These are bearer opt-outs, not gate bypasses.**
- `/mcp-user` skips the swarm-key check and self-authenticates via `aswt_` token in `handleMcpUser`.
  `/mcp` (owner transport) does NOT skip — it went through the bearer gate and additionally requires
  `X-Agent-ID` matching the session (`src/http/mcp.ts:60,72,89,92`).

## 2. MCP tool factory

**Answer: single factory, no per-tool permission hook yet, one clean insertion point.**

- **`createToolRegistrar`** — `src/tools/utils.ts:139`. 114/114 tool files use it; the only raw
  `server.registerTool` call is the factory internals. No ad-hoc `server.tool(...)` anywhere.
- **`ToolConfig` shape** (`src/tools/utils.ts:110-120`): `title, description, inputSchema,
  outputSchema, annotations, _meta`. `annotations` (`readOnlyHint`/`destructiveHint`/`openWorldHint`)
  is advisory only — it does **not** gate execution. **No `auth`/`requireLead`/`scope`/`permission`
  field exists.** Authz is imperative inside each handler body.
- **Identity is provided but not enforced here:** the wrapper injects a `RequestInfo` via
  `getRequestInfo` (`utils.ts:27`) carrying `x-agent-id`, `x-source-task-id`, `x-context-key`,
  `sessionId`.
- **The intended future chokepoint already has a home:** `src/tools/task-tool-ctx.ts` — `ToolCtx`
  discriminated union (`ownerCtx` `:9`, `userCtx` `:20`) and `assertOwnsTask` `:31`, whose comment
  at `:42` explicitly calls it "the RBAC chokepoint" for a future admin/role tier.
- **Collection:** `src/server.ts` — one `McpServer`, 114 `registerXxxTool(server)` calls from
  `:201`, partly gated by coarse capability flags (`hasCapability("task-pool")` etc. — feature
  flags, not auth). **Dispatch** is the SDK's internal name→handler map; no custom router.
- **Second surface:** `src/server-user.ts` `createUserServer(user)` re-registers 5 handlers
  (`send-task`, `get-tasks`, `get-task-details`, `cancel-task`, `task-action`) under `userCtx`
  (the `mcp__agent-swarm-user__*` names). Same factory; auth is structural (per-user server) +
  `assertOwnsTask` downstream.
- **Name registries** (distinct from runtime): `SDK_TOOL_NAME_MAP` (`src/scripts-runtime/
  sdk-allowlist.ts`) and `ALL_TOOLS` (`src/tools/tool-config.ts`), CI-tied by
  `scripts/check-sdk-tool-registration.ts`.

## 3. The `isLead` authz pattern — the migration target

**Answer: 34 enforced authz sites, all inline, NO central helper.**

No `requireLead`/`assertLead`/`requireRole`/`can()` exists anywhere. The only "helpers" are three
non-reusable, file-local functions that still inline the check: KV namespace guard (duplicated in
`kv-set.ts`/`kv-delete.ts`/`kv-incr.ts`), `authorizeWrite` (`src/http/kv.ts:313`), `canMutateTask`
(`src/http/fs.ts:432`). MCP denials are **soft** (return `{success:false}`); HTTP denials are real `403`.

Full list of the 34 category-(a) hard gates (file:line → action → rule):

| # | Site | Action | Rule |
|---|---|---|---|
| 1 | `manage-user.ts:89` | manage user profiles | lead |
| 2 | `update-profile.ts:175` | update another agent's profile | lead |
| 3 | `cancel-task.ts:74` | cancel task | lead OR creator |
| 4 | `inject-learning.ts:48` | inject learning into worker memory | lead |
| 5 | `delete-channel.ts:48` | delete Slack channel | lead |
| 6 | `context-history.ts:83` | view another agent's context | lead |
| 7 | `context-diff.ts:95` | diff another agent's context | lead |
| 8 | `memory-delete.ts:54,56` | delete swarm memory | owner OR (lead AND scope=swarm) |
| 9-10 | `register-kapso-number.ts:71,174` | (un)register inbound number | lead |
| 11 | `credential-bindings/tool.ts:60` | manage credential bindings | lead |
| 12 | `script-connections/tool.ts:63` | manage script connections | lead |
| 13 | `swarm-config/set-config.ts:100` | set `SCRIPT_CREDENTIAL_BINDINGS` | lead |
| 14-17 | `slack-post.ts:51`, `slack-read.ts:146`, `slack-start-thread.ts:45`, `slack-upload-file.ts:219` | direct channel post/read/thread/upload | lead |
| 18 | `skills/skill-create.ts:47` | create swarm-scope skill | lead |
| 19 | `skills/skill-install.ts:40` | install skill for another agent | lead |
| 20 | `skills/skill-install-remote.ts:46` | install remote/global skill | lead |
| 21 | `skills/skill-uninstall.ts:35` | uninstall skill for another agent | lead |
| 22-23 | `skills/skill-update.ts:70,116` | update skill / promote to swarm | owner OR lead / lead |
| 24 | `skills/skill-delete.ts:46` | delete skill | owner OR lead |
| 25 | `mcp-servers/mcp-server-create.ts:88` | create swarm/global MCP server | lead |
| 26-27 | `mcp-servers/mcp-server-install.ts:41`, `mcp-server-uninstall.ts:36` | (un)install MCP server for another agent | lead |
| 28-29 | `mcp-servers/mcp-server-delete.ts:43`, `mcp-server-update.ts:62` | delete/update MCP server | owner OR lead |
| 30-32 | `kv/kv-set.ts:22`, `kv-delete.ts:17`, `kv-incr.ts:17` | write another agent's `task:agent:` namespace | own OR lead |
| 33 | `http/kv.ts:329` | KV HTTP write to other namespace | own OR lead (403) |
| 34 | `http/fs.ts:442` | mutate task fs/attachments | operator/user OR lead OR owner |

**Documented-but-NOT-enforced gap:** `src/http/scripts.ts:97,146` advertise `403 "Global
write/delete requires lead agent"` in OpenAPI, but **no `isLead` check exists** in the handlers
(`upsertRoute` / delete only call `requireAgent` = existence). Global script write/delete is
currently **ungated**. (Correction to an earlier semble-search claim that this was enforced.)

**Adjacent soft scoping (not hard gates):** memory read-visibility widens for leads —
`memory-search.ts:81,93,100,168`, `memory-get.ts:138`, `graph-expansion.ts:53`,
`links-store.ts:142,182`, `sqlite-store.ts:791,818`. Maps to the "row-level reads" surface.

## 4. Identity plumbing (where a principal-stack hooks in)

- **`HttpRequestAuth`** (`src/utils/request-auth-context.ts:5-7`): `{kind:"operator",fingerprint}
  | {kind:"user",userId,user}`. Dual-stored in a `WeakMap<req>` + `AsyncLocalStorage`
  (`enterWith`), set by `setRequestAuth`. Accessors: `getRequestAuth(req)`,
  `getCurrentRequestAuth()`, `getCurrentRequestUserId()`.
- **Populated once**, in `handleCore` (`src/http/core.ts:251,259`) via `resolveHttpRequestAuth`
  (`src/http/auth.ts:13-31`): shared swarm key → operator; `aswt_` token → `resolveUserByToken`
  (`src/be/users.ts:490-514`) → user (if `status==="active"`). **No per-user API key exists —
  only the shared key + `aswt_` token.**
- **`getOperatorActor`** (`src/http/operator-actor.ts:43-68`) → `IdentityActor
  {kind:system|operator|user,id}`; fingerprint `op:<sha256(key)[:16]>`. Consumed **only** by
  `src/http/users.ts` mutation routes as the `actor` stamped on `user_identity_events`
  (`recordIdentityEvent`, `src/be/users.ts:266-298`). **No access decision reads `IdentityActor`.**
- **The only identity-driven authz gate is `canMutateTask`** (`src/http/fs.ts:432-444`): grants to
  any authenticated principal (operator OR user, unconditionally); the operator-vs-user
  *discriminant* itself never gates behavior beyond "authenticated or not."
- **`X-Agent-ID` is self-asserted and never authenticated** — read at `index.ts:281,285`,
  `core.ts:200`, `fs.ts:165`, `kv.ts:273,292`, `mcp.ts:71,87`; only "validated" by a possible
  `getAgentById` 404. `src/be/audit-user.ts:20-31` treats it as spoofable and cross-checks task
  ownership before trusting derived *audit* user (attribution, not authz). Confirms the brainstorm's
  latent-escalation note — the signed-token decision (brainstorm #9) closes this.

## 5. Originator propagation — `requestedByUserId` (BIGGEST DELTA vs May-15)

**Answer: it is ALREADY a live authorization/visibility gate, not attribution-only.**

- **Single insert path:** `createTaskExtended` (`src/be/db.ts:3284`, binds `requestedByUserId`
  at `:3494`), directly or via `createTaskWithSiblingAwareness` (`src/tasks/sibling-awareness.ts:138`).
  Legacy `createTask` (`db.ts:1303`) has **no** such column → always NULL. Each entry point resolves
  the user id itself; the DB layer does not.
- **Column:** `requestedByUserId TEXT REFERENCES users(id)` — **nullable**, added by migration
  `031_user_registry.sql:27` (partial index `idx_tasks_requested_by`). Schema
  `AgentTaskSchema.requestedByUserId: z.string().optional()` (`src/types.ts:405`).
- **Read for authz TODAY:**
  - `assertOwnsTask` (`src/tools/task-tool-ctx.ts:28`, "RBAC chokepoint"): owner ctx OR
    `task.requestedByUserId === ctx.userId` → else `Forbidden`. Called by `get-task-details.ts:56`,
    `cancel-task.ts:112`, `task-action.ts:178`.
  - User-scoped listing: `get-tasks.ts:105` hard-scopes to `requestedByUserId` for user ctx
    (DB filter `db.ts:1724`); HTTP sessions list same (`sessions.ts:29,77`).
  - Budget admission (adjacent): `canClaim(...requestedByUserId)` (`budget-admission.ts:74,120`).

- **Entry-point map** (source → creates where → populates? → how):

| Source | Where | Populates | Resolution |
|---|---|---|---|
| send-task | `send-task.ts:324,383,417` | conditional | `:191-197` user ctx→userId; else `arg ?? callerTask.requestedByUserId ?? undefined` |
| Slack | `slack/handlers.ts:630,703,718` | may be undefined | `resolveSlackUserId` (`enrich.ts:124`) → user or NULL+unmapped-kv |
| GitHub | `github/handlers.ts:256,361` | may be undefined | `resolveGitHubSender:174` |
| GitLab | `gitlab/handlers.ts:166,272,376,452` | may be undefined | `resolveGitLabSender:77` |
| Linear | `linear/sync.ts:615,898` | may be undefined | `resolveLinearActor:396` |
| AgentMail | `agentmail/handlers.ts:49,240,…` | may be undefined | `findOrCreateUserByEmail:180` |
| **Jira** | — none — | N/A | **no inbound task-creation path** (outbound/OAuth only) |
| **CLI** | — none — | N/A | `src/cli.tsx` creates no `agent_task` rows |
| Dashboard/HTTP | `http/tasks.ts:~402` | yes | `:367-373` user ctx→userId else body (existence-validated) |
| HTTP workflows | `http/workflows.ts:679` | yes | user ctx→userId else undefined |
| **Scheduler/cron** | `scheduler/scheduler.ts:49` | **NO** | never passed → NULL (no human originator) |
| Heartbeat / follow-ups / task-action | `heartbeat.ts:560,1053,1227`, `worker-follow-up.ts:167,331,432`, `task-action.ts:240` | via parent | inherited through `parentTaskId` |

- **send-task propagation verdict:** propagates the root originator **conditionally** — guaranteed
  when the caller runs as an agent with a resolvable `ctx.sourceTaskId`, OR `parentTaskId` is set
  and that ancestor carries a non-null id (second inheritance at `db.ts:3406-3409`). A chain that
  starts NULL **stays NULL** (nothing back-fills). Multi-hop root-originator propagation holds for
  non-null chains.

## 6. Row-level memory RBAC — merged-vs-not

**Answer: NONE of the settled RBAC × Memory design is merged.**

`agent_memory` columns today (base `001_initial.sql:271-287` + ALTERs): `id, agentId, scope, name,
content, summary, embedding, source, sourceTaskId, sourcePath, chunkIndex, totalChunks, tags,
createdAt, accessedAt` + `expiresAt/accessCount/embeddingModel` (036) + `alpha/beta` (051) +
`created_by/updated_by` (082, audit FKs to users) + `contextKey` (096) + `key/contentHash/version/
updatedAt` (099).

| Settled design element | Status |
|---|---|
| `ownerUserId` / `ownerPrincipalId` / `ownerPrincipalType` (3-col role-snapshot) | NOT merged (zero grep hits) |
| memory scope levels swarm/team/org | NOT merged — `scope` is `agent`/`swarm` only (`types.ts:1205`, CHECK at `001:274`) |
| downward-only scope filter on memory-search | NOT merged — current filter is agent/swarm + `isLead` **bypass** (`sqlite-store.ts:792-821`, `graph-expansion.ts:53`) |
| `requestedByUserId`-driven memory attribution | NOT merged — writes attribute via `changedByAgentId`/`created_by`/`updated_by` |

**Live tension:** memory's `isLead` bypass (leads see all scopes) directly contradicts the memory
design decision "leads get requester perms, no bypass." The design supersedes the code; the code
has not been changed yet.

## 7. `users.role` / UI scaffolding (closes Open Q)

**Answer: nothing reads it for an in-swarm access decision.**

- `users.role` — free-form nullable TEXT (`067_users_first_class.sql:153`), round-tripped in
  `users.ts:67,338` / `db.ts:11004`. Only two functional reads: (a) `agent-fs-provision.ts:413`
  maps it to a viewer/editor invite role in the **external** agent-fs service; (b)
  `apps/ui/.../people/[id]/page.tsx` for display/edit only. No caller compares it to
  admin/member/viewer to allow/deny.
- UI `UserRole = admin|member|viewer` (`apps/ui/src/api/types.ts:202`) — the only consumer is
  `NavItem.minRole?` (`app-sidebar.tsx:62`), **never assigned, never read**; comment says render
  logic does not consult it. Inert placeholder.

---

## Impact on the parked brainstorm's open items

1. **"Do any tools bypass `route()`/the MCP factory?"** → **CLOSED.** HTTP: one listener, nothing
   bypasses `handleCore`. MCP: 114/114 through `createToolRegistrar`. Enforcement-by-construction
   is viable on both surfaces. Caveat: the `scripts.ts` lead requirement is documented-only today.
2. **v2 sandbox controls** → still deferred (out of scope, unchanged).
3. **Performance budget for `can()`** → still a planning-time target (unchanged).

## Corrections / deltas to fold into the brainstorm

- `requestedByUserId` is **already load-bearing for authz** (`assertOwnsTask`, user-scoped listing,
  budget admission) — the May-15 doc's "make it load-bearing" is partially DONE. A user-RBAC v0
  effectively already ships for task ownership + visibility.
- Entry-point list correction: **Jira and CLI create no inbound tasks**; **cron/scheduler carries
  NULL** originator (matches the brainstorm's "no-originator fallback" need).
- The MCP-side "RBAC chokepoint" already exists as `assertOwnsTask` / `ToolCtx` in
  `task-tool-ctx.ts` — a cleaner extension point than the brainstorm anticipated.
- No per-user API keys yet — only the shared operator key + `aswt_` user token. The brainstorm's
  `user_api_keys` table is still net-new.
- Memory `isLead` bypass contradicts the settled memory design — a known cleanup for the memory
  slice when it lands.

## Code References (index)

- HTTP gate: `src/http/core.ts:197`, `src/http/index.ts:192,281`, `src/http/route-def.ts:148,70`,
  `src/http/auth.ts:13`
- MCP factory: `src/tools/utils.ts:139,110`, `src/tools/task-tool-ctx.ts:31,42`, `src/server.ts:201`,
  `src/server-user.ts`
- Identity: `src/utils/request-auth-context.ts:5`, `src/http/operator-actor.ts:43`,
  `src/be/users.ts:266,490,529`, `src/be/audit-user.ts:20`
- Originator: `src/be/db.ts:3284,3406,1724`, `src/tools/task-tool-ctx.ts:28`,
  `src/tools/get-tasks.ts:105`, `src/tools/send-task.ts:191`, `src/be/migrations/031_user_registry.sql:27`
- Memory: `src/be/memory/providers/sqlite-store.ts:792`, `src/be/memory/graph-expansion.ts:53`,
  `src/http/memory.ts:506,590`
- Scaffolding: `src/be/migrations/067_users_first_class.sql:153`, `apps/ui/src/api/types.ts:202`,
  `apps/ui/src/components/layout/app-sidebar.tsx:62`
- Prompt filter: `src/prompts/base-prompt.ts:98-112,165,171,262-281` (single insertion point:
  `buildBasePrompt`)
