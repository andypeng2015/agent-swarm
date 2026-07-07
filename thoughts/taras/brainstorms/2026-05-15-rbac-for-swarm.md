---
date: 2026-05-15T00:00:00Z
author: Taras
topic: "RBAC in the swarm — for agents and for users"
tags: [brainstorm, rbac, auth, security, multi-tenant, users, agents]
status: research-complete
exploration_type: idea
last_updated: 2026-07-06
last_updated_by: Claude
related_research: thoughts/taras/research/2026-07-06-rbac-enforcement-surfaces.md
---

# RBAC in the swarm — for agents and for users — Brainstorm

## Context

Taras wants to explore introducing Role-Based Access Control across the swarm, covering two distinct surfaces:

1. **Agent RBAC** — what each agent (worker / lead) is allowed to do at the API + tool level.
2. **User RBAC** — what each human interacting with the swarm (via dashboard, Slack, Linear, GitHub, etc.) is allowed to do.

### Existing state (recon at start of session)

- **`users` table** (mig `031_user_registry.sql`):
  - Columns: `id, name, email, role, notes, slackUserId, linearUserId, githubUsername, gitlabUsername, emailAliases, preferredChannel, timezone, …`
  - `role TEXT` is **free-form** today (e.g. `'founder'`) — no enforcement, just a label.
  - Seeded values were removed in mig `039_remove_seed_users.sql`; users now seeded via backfill script.
  - `agent_tasks.requestedByUserId` already FKs into `users` — canonical identity for who asked for a task.

- **`agents` table** (mig `001_initial.sql`):
  - Has `role TEXT` and `capabilities TEXT DEFAULT '[]'` — both free-form, neither is enforced as a permission boundary.
  - `isLead INTEGER` is the only structural distinction in code today.

- **Authentication today**:
  - Single global `API_KEY` (Bearer token) — every caller, agent or user, shares the same secret.
  - `X-Agent-ID` header identifies the agent making a call (worker → API loop). No verification that the agent_id "belongs" to the bearer of the API_KEY.
  - No per-user API keys, no per-agent token, no scoped credentials.
  - The `api_key_status` table tracks **LLM provider** keys (Claude / OpenAI / OpenRouter), not swarm-API auth keys.

- **Integrations**:
  - Slack / Linear / GitHub / Jira / Codex have OAuth tokens stored in `swarm_config` (encrypted, mig `038`).
  - MCP servers can have OAuth tokens (mig `041`).
  - No notion of "this user is allowed to use this Slack token" — the swarm acts as a single principal.

### What "RBAC" could mean here — two surfaces, very different shapes

| Surface | Subject | Object | Example permission |
|---|---|---|---|
| Agent | agent (worker) | API endpoint / MCP tool / channel / repo / integration | "agent X can post to Slack but cannot run `db-query`" |
| User | human user | dashboard view / task / config / cost data / billing | "Eze can view but not edit swarm_config" |

Initial thoughts:
- Today the swarm is effectively single-tenant + single-principal. Anything with the API_KEY can do anything.
- This is fine for solo / small-team usage, but becomes painful as soon as: (a) the swarm is shared by a real team, (b) cloud/multi-tenant deploys, (c) agents from outside (managed agents, third-party integrations) need scoped access, (d) compliance / audit.
- The two surfaces share infrastructure (an authz check, a roles table, a policy evaluator) but may need very different role taxonomies.

## Exploration

### Q: What's driving this RBAC exploration right now?
A mix of **(2) team-shared single swarm** and **(3) agent capability scoping**. Applies to both cloud deploys and self-hosted (especially for bigger teams). **RBAC should be an opt-in feature.**

**Insights:**
- Not driven by multi-tenant cloud isolation (that's a separate, bigger story) and not driven yet by formal compliance / SOC2 requirements.
- "Opt-in" is a strong constraint: existing single-user / small-team deployments must keep working with no changes. Default mode = no RBAC = today's behavior (single API_KEY, every agent does everything).
- The two motivations naturally pair: a bigger team probably also wants to limit which agents can touch dangerous tools, and agent scoping needs *some* notion of "who owns / configured this agent" to attribute decisions.
- Implies the design must have a **disabled / permissive default**, with explicit activation (e.g. `RBAC_ENABLED=true` or `swarm_config.rbac_mode = 'enforce'`). Until enabled, all permission checks should short-circuit to allow.
- Both self-hosted and cloud — so the system can't rely on cloud-only infrastructure (e.g. external IdP) as a hard dependency. Must work with a fully local SQLite + Bun stack.

### Q: How does an individual human user authenticate against the swarm API / dashboard when RBAC is enabled?
A mix — most important are **(1) per-user API keys**, **(3) OAuth / SSO**, and **(4) Slack/Linear identity passthrough**. Email/password is explicitly *not* prioritized.

**Insights:**
- Per-user API keys = the canonical, programmatic identity. Likely the primary subject that gets attached to every API call. CLI + curl + dashboard-issued tokens all converge on this primitive.
- OAuth/SSO (Google, GitHub) is the *bootstrap* mechanism for getting into the dashboard — first time you sign in, an entry is created/linked in `users`, and you can issue yourself per-user API keys from there.
- Slack/Linear identity passthrough is the *channel-native* path — when you DM the bot, your `slackUserId` already resolves to a row in `users`. So inside Slack/Linear, the swarm authenticates you via the integration's signed payload; no separate login. The same `users.id` is the subject for permission checks.
- Skipping password management is good: keeps secret-management surface area down. Self-hosted users who really want passwords can ship their own SSO (e.g. an OIDC proxy in front).
- This implies a `user_api_keys` (or `user_credentials`) table with: `id, userId, keyHash, keyPrefix, name, scopes?, lastUsedAt, createdAt, revokedAt, expiresAt`. The current global `API_KEY` becomes a special "root/admin" key when RBAC is enabled — or is disabled entirely once at least one user key exists.
- Three identity paths must converge on the **same `users.id`**: API key lookup → user; OAuth callback → user; Slack/Linear webhook → user (via existing `slackUserId` / `linearUserId` columns). The `users` table is already wired for this — the schema barely needs to change.
- Self-hosted concerns: OAuth requires a configured provider (Google/GitHub OAuth app) per deploy. Acceptable since RBAC is opt-in; a self-hosted admin who turns it on accepts that they need to configure an OAuth client. Until then, per-user API keys generated by the admin (via CLI?) are enough.

### Q: What's the shape of the permission model?
**Role → permissions table** — classic RBAC. Roles defined in DB, permissions are named verbs, joined via `role_permissions`. Users get one or more roles. Extensible at runtime.

**Insights:**
- Implies tables roughly like: `roles(id, name, description, scope)`, `permissions(id, name, description)`, `role_permissions(roleId, permissionId)`, `user_roles(userId, roleId)`. Permissions are seed data the swarm ships with; roles can be both seeded (`owner`, `admin`, `member`, `viewer`) and user-defined.
- Permission names should be verb-namespaced and granular: `task.create`, `task.cancel`, `task.read.own`, `task.read.any`, `config.read`, `config.write`, `agent.create`, `agent.delete`, `integration.slack.post`, `cost.read.any`, etc. Document them centrally — they become an API contract.
- Two sub-decisions still open and worth probing:
  1. **Multi-role per user?** (UNION of permissions) vs single-role. Multi-role is more flexible (`developer` + `billing-viewer`) but harder to reason about.
  2. **Ownership / row-level scoping** — `task.read.own` vs `task.read.any` implies the check needs to know "did this subject create this row?" Either bake it in (split each verb into `.own` / `.any` like above) or handle it ad-hoc at each check site. The former scales worse, the latter is messier.
- Roles are shared between **users and agents**? Or two separate role tables? Probably separate role *taxonomies* (a user's "admin" role isn't comparable to an agent's "slack-poster" role) but they can share the underlying `permissions` table and check infrastructure. Worth confirming.
- Permission strings as the single source of truth means typecheck-friendly enums (Zod / TS literal types) generated from / kept in sync with a single registry — otherwise it's easy to misspell `task.read` vs `tasks.read` at check sites.
- `role_permissions` join lets admins customize via the dashboard, but a *good default* set of roles is critical — most users will never touch role definitions. Seeded `owner / admin / member / viewer` for users; seeded `lead / worker / restricted-worker` (or similar) for agents.

### Q: What does agent identity / authn look like when RBAC is on?
A mix of **(2) shared key + signed agent identity** and **(4) trust agents, scope at tool layer**. **Critical extra constraint:** the same agent's effective permissions may need to be limited based on *who interacts with it*.

**Insights:**
- The "who interacts with it" constraint is the most important architectural insight so far. It means effective permission ≠ static `agent.role`. The check is:
  ```
  effective = agent.permissions ∩ requesting_user.permissions
  ```
  This is **principal-on-behalf-of** / OAuth-style delegation semantics. The agent has its own ceiling, but per-task it's further constrained by who asked for the task. If Eze (member) DMs an agent in Slack to "delete production data", and member doesn't have `task.dangerous`, the agent must refuse — *even if the agent's own role permits it*.
- This implies every agent action must carry **both** an agent subject and a user subject (the "originator"). For task-driven work, the user is `agent_tasks.requestedByUserId`. For ad-hoc API calls from an agent without an originating task, the API must still know "on whose behalf" — which means the agent token / context needs to encode an originator, OR the swarm has to decline non-attributed dangerous actions.
- This naturally fits **(2) signed agent identity**: the agent's JWT-ish token can be issued *with* an embedded `originator_user_id` per task (delegation token). Lead → worker handoff would mint a fresh token bound to the originating user.
- And **(4) tool-layer scoping** still works: at *prompt assembly time*, only expose the tools that lie inside the intersection. The agent never sees a `delete-channel` MCP tool if it (or its current originator) lacks `channel.delete`. This is the cleanest UX — agent literally can't even attempt the disallowed action.
- Backwards compat: the shared `API_KEY` remains the "admin / system" bearer (e.g. for the runner to register agents, for unattended tasks created by webhooks). When a webhook-triggered task has no user originator, it falls back to the agent's own role only (or to a "system" pseudo-user with explicit configured permissions).
- Notable: **X-Agent-ID self-assertion** today is a latent vulnerability — once RBAC is on, a worker that lies about its agent_id could escalate. The signed token (2) closes this without forcing every worker to roll a new key.
- Open: what's the *originator* when the trigger is Slack? It's the Slack user who sent the message, resolved through `users.slackUserId`. Already wired. Same for Linear/GitHub. What about webhooks from systems without a user (cron, Sentry alert)? Need a "system originator" concept with an explicit configured role.

### Q: What happens when there's no clear originator (Sentry webhook, cron, autonomous agent work)?
**Configurable default role** for unattributed actions (which can default to admin if that's OK in the deploy), **plus** the ability to define roles for individual entrypoints (per trigger source).

**Insights:**
- This is essentially "principal hierarchy with a global default override":
  - Global default: `rbac.default_unattributed_role` (admin by default — backwards-compat friendly).
  - Per-entrypoint override: each integration / trigger source can be assigned its own role, evaluated when no user originator is available.
- Concretely: a `trigger_sources` table (or a `roleId` column on existing integration/schedule tables): `{ id, kind, name, roleId, ... }`. Examples:
  - `sentry-prod` integration → role `incident-responder` (can create tasks tagged #incident, can post to #alerts, cannot edit config).
  - `nightly-cleanup` schedule → role `maintenance-bot` (can prune memory, cannot touch tasks).
  - `github-webhook:repo-x` → role `pr-reviewer` (can comment on PRs in repo-x, nothing else).
- This generalizes nicely: agents themselves are just another principal with a role; users are principals with roles; trigger sources are principals with roles. The check site doesn't care which kind — it asks "does this principal stack have permission P?".
- Effective permission becomes a stack:
  ```
  effective = intersect(user_or_default.perms, agent.perms, trigger_source.perms?)
  ```
  Each missing layer just contributes `ALL_PERMISSIONS` (no constraint) instead of dropping out, so absent layers don't tighten the set.
- Sensible defaults:
  - When RBAC is *disabled*: everything allowed (today's behavior).
  - When RBAC is *enabled* but `default_unattributed_role` is unset: admin (avoid breaking webhooks). Surface a warning in the dashboard nudging the user to scope it.
  - Per-entrypoint roles are opt-in refinements admins can apply incrementally — they don't need to configure every integration on day one.
- The principal-stack model also clarifies an earlier muddle: lead-vs-worker, agent-vs-trigger, user-vs-agent are *not* hierarchical types — they're all principals with roles. The schema can collapse to a small set of polymorphic concepts (`principals`, `principal_roles`).

### Q: Where's the most important place to enforce permission checks for v1?
**(1) HTTP/MCP endpoints**, **(2) tool-prompt assembly**, and **(3) row-level filtering on reads** all in v1. (4) outbound integrations is a *subset of* (1)/(2) — handled by the same primitive. **v2 nice-to-have:** sandbox-level controls (network, filesystem, env-var access from within the agent's runtime).

**Insights:**
- This is an ambitious v1 scope — three layers of enforcement is more than most RBAC implementations ship with. Worth flagging in synthesis as a phasing decision: v1 might land (1) + (2) as MVP, and (3) row-level as a fast-follow.
- **(1) HTTP/MCP endpoints**: the route-handler factory (`route()` in `src/http/route-def.ts`) is the natural choke point. Add a `permissions: ['task.create']` field to route definitions; the factory enforces it before invoking the handler. Similarly, every MCP tool definition gets a `permissions` field. Single place to add a check = enforcement-by-construction.
- **(2) Tool-prompt assembly** (`src/prompts/`): when building an agent's system prompt + tool list, compute the effective permission set and filter out tools whose permission is missing. The agent never *sees* a forbidden tool — no temptation, no failed calls, less prompt bloat. Same principle for skills, MCP servers, channels listed in `list-channels`, etc.
- **(3) Row-level scoping**: every list/read query that surfaces data must thread the principal as a filter. Practically:
  - `getTasks({ principalId })` → returns only rows where requester / assignee / channel membership permits.
  - Channels with explicit member lists; pages with `ownerUserId`; memory entries with visibility scopes (already partly there).
  - Most invasive change because it touches a lot of queries in `src/be/db.ts`. Worth treating row-level as a *capability per resource type*: start with tasks + channels + pages, expand from there.
- **(4) outbound integrations** falls out for free: posting to Slack goes through a `slack-post` MCP tool / a `slack` route — both already gated by (1)/(2). The permission name `integration.slack.post` ties directly to the tool and route.
- **v2 sandbox controls** (network/fs/env from the agent's runtime): this is a different beast — enforced at the Docker/worker boundary, not in the API. Map to existing Dockerfile.worker concerns; could leverage seccomp / network policies / read-only mounts. Probably worth a separate brainstorm later — note in Open Questions.
- Implication for the schema: a permission needs to know *which surface* it applies to, OR we standardize that the same permission string is honored consistently across surfaces. The latter is simpler: `task.create` applies at the HTTP route, at the MCP tool, and (where readable) is also the gate for the prompt to expose the tool. One name, three enforcement sites, same answer.
- Defense-in-depth caveat: row-level (3) must NOT be skipped when (2) already filtered the tool. Reason: an agent could call an unintended tool via another agent / via a script that didn't go through prompt assembly. So (2) is UX/safety; (1)+(3) are the security boundary.

### Q: How granular should resource scoping be in v1?
**Resource ACLs** on the key shared objects: channels, repos, agents. Per-resource grant tables.

**Insights:**
- This is materially more ambitious than "global only". Implies:
  - `channel_members(channelId, principalId, role)` — already partly there in the channels concept; needs to be the canonical access mechanism.
  - `repo_access(repoId, principalId, role)` — who can configure / target / receive PRs into a repo.
  - `agent_access(agentId, principalId, role)` — who can talk to / send tasks to / configure a given agent. Note this is also where the "same agent restricted by who talks to it" idea lives.
- Permission check signature becomes: `can(principal, verb, resource?)`. When `resource` is non-null, the check looks at the ACL for that resource first; if no ACL row exists, fall back to global role permissions.
- ACL roles need their *own* small taxonomy per resource type: `channel: owner | member | viewer`, `repo: admin | contributor | reader`, `agent: owner | user | observer`. These are resource-local; they don't appear in the global `roles` table.
- This naturally answers the earlier "same agent restricted by who talks to it" point: the agent has a global role (its ceiling), AND each user has an `agent_access` row describing what they can do with this agent. A user without `agent_access` for agent X can't send it tasks at all (or only with `observer` rights).
- Risks / complexity:
  - Default ACLs are critical — if every new channel/repo/agent starts with empty ACL, the swarm grinds to a halt under RBAC. Need sensible defaults (e.g. "creator becomes owner", "members of parent workspace inherit observer").
  - Inheritance / wildcards? "Default access for all members" vs "explicit grants only"? Probably ship without inheritance in v1; revisit if it's painful.
  - Performance: every list endpoint needs a JOIN to the ACL table; consider denormalized cache or materialized view if scale becomes an issue. SQLite is fine for this at swarm sizes.
- Skipped on purpose: **hierarchical scopes / projects**. The swarm doesn't have a project concept today, and inventing one just for RBAC is yak-shaving. Resource ACLs achieve 80% of what projects would give.
- Tasks themselves: probably *don't* need explicit ACLs — they inherit access from the channel/repo/agent they belong to. Cheaper and more intuitive. Worth confirming.

### Q: What audit story do we want from v1?
**Full action audit** — every permission check writes an audit row (principal, verb, resource, allow/deny, timestamp).

**Insights:**
- Strong choice for trust + debuggability. The audit log doubles as the *primary* debug trail when an agent or user says "I tried X and it failed" — instead of grepping logs, you query the audit table.
- Implies a single `permission_audit` (or `audit_events`) table written from one place: the central permission-check function. Every `can()` call → one row. Shape: `{ id, ts, principalId, principalType, originatorUserId, verb, resourceType, resourceId, decision: 'allow'|'deny', reason, source: 'http'|'mcp'|'prompt' }`.
- Write volume risk is real but manageable for a swarm-scale workload (this isn't a SaaS auth service at millions QPS). Mitigations:
  - Batch writes (in-memory ring buffer flushed every N ms or M rows).
  - Async write off the request path — the audit row is fire-and-forget; never block the API response.
  - Retention policy: keep last 30d hot, archive/purge older. New migration adds a `cleanup_audit_events` cron-style task.
  - Optionally skip auditing the most innocuous reads (`task.read.own` hits) via a denylist of "boring verbs" — explicit opt-out, default include.
- Decision granularity: prefer `decision: 'allow' | 'deny'` rather than only logging denies. Denies tell you what was blocked; allows tell you what was *done*. For a security incident you need both.
- "Reason" field is the key UX win — when a check denies, store *which permission was missing* (`missing: 'task.delete'`) and *at which layer* (agent ceiling? originator intersection? ACL?). Future-Taras debugging permission bugs will love this.
- Important: the audit log itself must respect RBAC. Only an admin/owner can read it; users can see only their own actions (`audit.read.own`). Define this on day one.
- Integration with existing telemetry: business-use already captures task lifecycle events. Audit is *different and complementary* — audit is verb-level (one row per check), business-use is flow-level (one event per state transition). Don't merge them.
- Could expose a UI tab in the dashboard: "Recent permission denials" — surfaces misconfigured roles fast.
- All of the above is contingent on RBAC being enabled. Disabled mode = no audit writes = today's behavior.

### Q (interim, settled): Migration story for existing deploys
**Opt-in, no-op if not enabled.** The migration question is settled: existing deploys see zero behavioral change until `RBAC_ENABLED=true` (or equivalent `swarm_config` flag). When toggled on, sensible defaults must let the swarm keep running.

**Insights:**
- All RBAC-related tables (`roles`, `permissions`, `role_permissions`, `principal_roles`, `*_access`, `permission_audit`, `user_api_keys`) can land as additive migrations and stay dormant.
- The single `RBAC_ENABLED` check at the start of `can()` is the master switch. When false → `return { allow: true }`. No DB reads, no audit writes.
- Upgrade flow (for an admin turning it on): (a) seed default roles, (b) backfill ACLs with permissive defaults (existing channel members → channel.owner; existing tasks → owners inherit access), (c) flip flag. Backfill must be idempotent and ship as a CLI command (`bun run src/cli.tsx rbac:bootstrap`).

### Q: What's the primary admin UX shape in the dashboard?
**Roles-first workflow.** Admin defines roles (with editable permission lists), then assigns roles to users / agents / trigger sources. Roles are the central object.

**Insights:**
- A roles-first UI pairs naturally with the "role → permissions table" model from earlier. Single source of truth in code matches single source of truth in UI.
- Concrete pages / routes in `ui/`:
  - `/settings/rbac/roles` — list of roles. Each row: name, permission count, assignee count. New / Edit / Delete.
  - `/settings/rbac/roles/[id]` — role detail. Two-pane: left = checkbox grid of all known permissions grouped by namespace (`task.*`, `config.*`, etc.); right = list of principals assigned to this role with quick-remove.
  - `/settings/rbac/permissions` — read-only catalogue of every permission the swarm ships with, plus a description. Good for discovery and onboarding ("what does `task.cancel.any` even mean?").
  - `/settings/rbac/api-keys` — per-user API keys with revoke + rotate.
- Resource ACLs from the earlier Q still need *somewhere* to live, even if not the primary UX. Recommendation: surface them inline on the resource's own page (channel settings, agent settings) — a small "Access" section. Don't build a separate "shares" mega-page; let the role workflow cover the 80% case and per-resource ACLs the long tail.
- Default roles (seeded) need a visual "system" badge and a read-only set of *core* permissions, so admins can't accidentally remove `users.read` from `viewer` and break the dashboard. They can clone defaults to customize.
- Permission catalogue must be auto-generated from a TS registry — never hand-maintained in the UI. The registry lives in `src/rbac/permissions.ts` (or similar) and exports the list + descriptions. Build step (or runtime read) populates the dashboard.
- Onboarding friction: when an admin turns RBAC on for the first time, the dashboard should show a one-time wizard — "Pick which role each existing user gets" — preventing the "I locked myself out" panic. The user enabling RBAC auto-gets `owner` so they can always reverse it.
- Bonus UX: a "test as another role" toggle (impersonation for visualization, NOT for action). Lets the admin preview "what does `viewer` see?" without making another login. Read-only, audit-logged.

### Q: Agent-to-agent calls — who's the originator when the chain spans multiple users?
**Propagate root originator.** The originator user is fixed at the root of the chain (the human or trigger source that started it) and propagated through every downstream agent call. Effective perms always = `agent ∩ root_user`.

**Insights:**
- Cleanest semantics, and aligns naturally with `agent_tasks.requestedByUserId` — that column **is** the root originator. Every child task / send-task / sub-agent call inherits the parent's `requestedByUserId`. Already (mostly) the case structurally; we just need to enforce it.
- Implementation:
  - `send-task` tool: child task's `requestedByUserId` = parent task's `requestedByUserId` (already true today if propagated; verify in `src/tools/send-task.ts`).
  - Lead spawning workers: each worker session inherits the originator from the task it picks up. The signed agent-context token (from the earlier (2) shared-key + signed identity choice) gets the originator embedded for the lifetime of that task.
  - `request-human-input` reply: the *reply* triggers continuation of the SAME task — originator does NOT switch to the responding human. The responding human is just feeding information back; the principal-on-behalf-of is still the root originator. (This differs from option 4, which we rejected.) Audit logs should still capture the responder's identity for the action they took, but the agent's downstream perms continue to use root.
  - Webhook/cron-initiated tasks: root originator = configured trigger-source role (no human). Propagation is unchanged.
- Risk Taras flagged in option 1: a long-running task started by user A keeps acting as A even after A is off-boarded. Mitigations:
  - On user deactivation, optionally cancel or pause their in-flight tasks (configurable: `rbac.on_user_deactivate = cancel | pause | continue`). Default to `pause` — safest behavior, admin decides what to do.
  - Audit log captures user state at action time; revocation is point-forward, not retroactive.
- Pipe-cleaner test cases (worth in synthesis as acceptance scenarios):
  1. User A (member) DMs agent in Slack → agent delegates via send-task → grandchild task tries to call `config.write` → must DENY (A is not admin).
  2. Cron schedule (role `maintenance-bot`) creates task → worker delegates to another worker → both workers' actions check against `maintenance-bot` perms.
  3. User A (admin) starts task → A is deactivated mid-task → in-flight chain pauses; admin gets a "stalled task needs reattribution" notification in the dashboard.
- Side effect: the originator must be a *first-class* field on the principal-stack for every action, not derived JIT. Means `agent_tasks.requestedByUserId` becomes load-bearing for security, not just for analytics. Worth a NOT-NULL constraint on RBAC-enabled deployments (with a fallback to a special `system` user where no human/source exists).

## Synthesis

### Key Decisions

1. **RBAC is opt-in — but "disabled" means built-in legacy policy, not allow-all.** *(Refined 2026-07-06.)* The **configurable role engine** is opt-in behind a single flag (`RBAC_ENABLED` env or `swarm_config.rbac_mode`). But `can()` disabled-mode does **not** short-circuit to `allow: true` — it applies a **hardcoded default policy that reproduces today's exact rules** (the 34 `isLead` gates + `assertOwnsTask` ownership + kv/fs namespace guards). This is required so that migrating the always-on `isLead` gates through `can()` is a behavior-preserving refactor and does not regress lead protection for non-RBAC deploys. Only when the flag is ON does `can()` consult the role tables (whose seeded defaults reproduce the built-in policy, so enabling is itself a no-op until an admin customizes). Audit writes: still skipped in disabled mode (see incremental strategy — audit can be added independently).
2. **Permission model = role → permissions table.** Roles are first-class DB objects with editable permission lists. Users / agents / trigger sources are assigned one or more roles. Permission strings are verb-namespaced (`task.create`, `config.write`, `integration.slack.post`) and live in a typed registry in code.
3. **All actors are principals.** Users, agents, and trigger sources (webhooks, schedules, integrations) all collapse to the same `principals` abstraction with assignable roles. No special-case hierarchies for "lead vs worker" or "human vs bot" in the permission engine.
4. **Effective permissions = intersection of the principal stack.** For any action: `effective = agent.perms ∩ originator.perms (∩ trigger_source.perms if present)`. Missing layers contribute "no constraint" (full set). Delegation is OAuth-style: an agent acts on behalf of its originator and can never exceed them.
5. **Originator propagates from the root of the chain.** Whoever started the task (human user, Slack DM, cron, webhook) stays the originator through every send-task, lead→worker, and request-human-input continuation. `agent_tasks.requestedByUserId` is the canonical column.
6. **No-originator fallback is configurable.** A swarm-wide `rbac.default_unattributed_role` (defaults to `admin` for backwards compat) handles webhooks/cron without an originator. Each trigger source can override with its own assigned role.
7. **Three enforcement surfaces in v1:**
   - **(a) HTTP/MCP endpoints** — `permissions: [...]` field on route definitions in `src/http/route-def.ts` and on MCP tool definitions in `src/tools/`. The factory enforces before dispatch.
   - **(b) Tool-prompt assembly** — `src/prompts/` filters the exposed tools/skills/MCP servers/channels to the principal's effective set. Agent never sees forbidden tools.
   - **(c) Row-level filtering on reads** — every list/read query threads the principal as a filter; queries return only the rows the principal can see.
   Outbound integrations (Slack post, GitHub PR write, etc.) fall under (a)/(b) since they go through routes/tools. Sandbox-level controls (network, FS, env) are explicitly **v2**.
8. **Resource ACLs for the big three: channels, repos, agents.** Per-resource grant tables: `channel_members`, `repo_access`, `agent_access`. Tasks inherit access from their channel/repo/agent rather than carrying their own ACL. Each ACL has a small resource-local role taxonomy (`owner | member | viewer`, etc.).
9. **Agent identity = shared key + signed agent context token.** Backwards-compat with the global `API_KEY`, but agents additionally present a signed token (issued at registration) carrying `agent_id`, `originator_user_id`, and any in-flight task scope. The self-asserted `X-Agent-ID` header is replaced by claims in the signed token. Tool-layer scoping (prompt-time filtering) complements but does not replace this.
10. **User auth = three converging paths, one `users.id`.** (a) Per-user API keys (canonical programmatic identity, stored hashed in `user_api_keys`); (b) OAuth/SSO (Google/GitHub) for dashboard bootstrap; (c) Channel-native passthrough (Slack/Linear identity resolved via existing `users.slackUserId` / `linearUserId` columns). Email+password explicitly not supported.
11. **Full action audit log.** One `permission_audit` row per `can()` call: `{ ts, principalId, principalType, originatorUserId, verb, resourceType, resourceId, decision, reason, source }`. Written async/batched off the request path; retention policy with `cleanup_audit_events` task. Disabled mode = no audit writes.
12. **Dashboard UX is roles-first.** Primary surfaces: `/settings/rbac/roles` (list + edit), `/settings/rbac/permissions` (auto-generated catalogue from the typed registry), `/settings/rbac/api-keys`. Per-resource ACLs surface inline on each resource's settings page (no dedicated "shares" page). One-time wizard on first enable to assign existing users to roles. "Test as another role" preview (read-only, audit-logged).

### Open Questions

The first batch was resolved in a follow-up chat after the initial synthesis. The remaining items require codebase research or are deferred to v2 / set during planning.

**Resolved in follow-up chat:**

- **Multi-role per user vs single-role** → **Multi-role, UNION semantics.** A user can hold N roles; effective permissions = union. UI flattens to a resolved view of "what can Bob actually do". Composition stays cheap (`developer` + `billing-viewer`).
- **Ownership-encoded permissions** → **Permission-name convention (`.own` / `.any`).** Each check site declares which is required. Resource ACLs handle scoping where they exist; reads without a natural ACL parent still get the `.own` / `.any` split. Pay the 2× permission-name cost for explicitness.
- **Behavior when the root originator is deactivated** → **Default = `pause`.** In-flight tasks originated by the deactivated user pause; admin gets a dashboard notification with a reassign/cancel action. Configurable per swarm via `rbac.on_user_deactivate`.
- **NOT NULL on `agent_tasks.requestedByUserId` when RBAC is on** → **Required at the RBAC layer, not the schema.** Column stays nullable in SQL (avoids breaking RBAC-disabled deploys and tests). Task-creation code resolves to a built-in `system` user when no human/trigger source applies. The permission engine asserts non-null at action time when RBAC is on.
- **Audit-log reads for non-admins** → **Yes — `audit.read.own` granted by default.** Surfaced as a "My activity" tab. Admins get `audit.read.any` for cross-user views. Doubles as a debugging tool and a trust surface.
- **Backfill semantics on first enable** → **Enabler gets `owner` on every channel/repo/agent; all other active users get `member`.** Every backfill grant is audit-logged. Admin tightens explicitly afterward by removing rows. "Open by default, lock down deliberately" — matches the opt-in spirit.

**Resolved by codebase research (2026-07-06 — see `thoughts/taras/research/2026-07-06-rbac-enforcement-surfaces.md`):**

- **Are there tools today that bypass `route()` / the MCP tool factory?** → **CLOSED. No.**
  - HTTP: exactly one production listener (`src/http/index.ts:192`); `handleCore` (`src/http/core.ts:197`) runs first on every request and nothing bypasses the auth gate. ~288 `route()` defs across ~48 files; the 20 `apiKey:false` public routes (webhooks / OAuth callbacks / public pages / page-proxy) still pass through `handleCore` and self-verify downstream. A `permissions:[]` field on `route()` covers the whole HTTP surface.
  - MCP: 114/114 tools go through one factory (`createToolRegistrar`, `src/tools/utils.ts:139`). No ad-hoc registration. Enforcement-by-construction is viable on both surfaces.
  - **Caveat (latent gap):** `src/http/scripts.ts:97,146` *document* a `403 "requires lead agent"` in OpenAPI but **do not enforce it** — global script write/delete is currently ungated. The RBAC work closes this.

**Still open / deferred:**

- **v2 sandbox controls (network / FS / env from worker runtime)** — separate surface, deferred. Its own brainstorm later; **tracked as [DES-676](https://linear.app/desplega-labs/issue/DES-676) in Taras Brain** (2026-07-06).
- **Correctness over performance for `can()` and row-level filters.** *(Taras, 2026-07-06.)* Priority is a correct, easy-to-reason-about policy engine — no clever caching or perf shortcuts that risk a wrong allow/deny. Performance is a non-gating concern: measure it, but do not trade correctness for it. Optimize only if a real hotspot shows up (SQLite at swarm scale is expected to be fine).

## 2026-07-06 Refresh — codebase research folded in

Full map: `thoughts/taras/research/2026-07-06-rbac-enforcement-surfaces.md` (git `9015e5be`). The 12 settled decisions above hold. Deltas that change the *plan*, not the design:

### Corrections to the 2026-05-15 recon

1. **`requestedByUserId` is ALREADY load-bearing for authz** — not attribution-only as the original doc assumed. It drives three live gates today:
   - `assertOwnsTask` (`src/tools/task-tool-ctx.ts:28`) — comment literally reads "RBAC chokepoint"; denies `get-task-details` / `cancel-task` / `task-action` when `task.requestedByUserId !== ctx.userId`.
   - User-scoped task listing (`src/tools/get-tasks.ts:105`, DB filter `src/be/db.ts:1724`; HTTP `sessions.ts:29,77`).
   - Per-user budget admission (`src/be/budget-admission.ts:74`).
   → **A user-RBAC v0 (task ownership + visibility) effectively already ships.** Decision #5 ("originator propagates from root") is partly implemented: `send-task` propagates the root originator through `ctx.sourceTaskId` and a second `parentTaskId` inheritance at `src/be/db.ts:3406`. Gap: a chain that starts NULL stays NULL (nothing back-fills).

2. **Entry-point list correction (Decision #5 / Core Req #5):** **Jira and CLI create NO inbound `agent_task` rows** (Jira is outbound/OAuth only; `src/cli.tsx` creates none). **Cron/scheduler intentionally carries NULL** originator (`src/scheduler/scheduler.ts:49`) — this is exactly the "no clear originator" case Decision #6 designed the `default_unattributed_role` for. Real inbound sources with originator resolution: Slack, GitHub, GitLab, Linear, AgentMail, dashboard/HTTP, workflows. All resolve via `findUserByExternalId` → email cascade → NULL+unmapped-kv fallback.

3. **The MCP-side chokepoint already exists** — `assertOwnsTask` / `ToolCtx` (`ownerCtx`/`userCtx`) in `src/tools/task-tool-ctx.ts` is the natural place to generalize into `can()`, cleaner than anticipated. The per-tool `permissions` field (Core Req #3) is still net-new (the `ToolConfig` shape at `src/tools/utils.ts:110` has no auth field).

### `isLead` migration target is concrete: 34 sites, no helper (Decision #2, Core Req #3)

There is **no** central `requireLead`/`assertLead`/`requireRole`/`can()` anywhere — 34 enforced authz sites are all inline `if (!agent?.isLead)`. Full enumerated table in the research doc §3. This is the exact replace-list for the central `can()`. MCP denials are soft (`{success:false}`); HTTP denials are real `403`. Note the memory read-visibility `isLead` checks (memory-search / graph-expansion) are *soft scoping*, a distinct surface from the 34 hard gates — they belong to Decision #7(c) row-level, not the tool-gate.

### Identity substrate (Decision #9, #10)

`HttpRequestAuth` (`src/utils/request-auth-context.ts`) already carries the `operator` (shared key) vs `user` (`aswt_` token) distinction, dual-stored in a WeakMap + AsyncLocalStorage, populated once in `handleCore`. **But there are NO per-user API keys yet** — only the shared operator key + `aswt_` MCP token; the `user_api_keys` table (Core Req #4) is net-new. `X-Agent-ID` is confirmed self-asserted / unauthenticated (`src/http/core.ts:200`) — Decision #9's signed agent-context token is what closes this. Today identity drives exactly one gate (`canMutateTask`), and only on "authenticated-or-not," never on *which* user — so the operator/user discriminant is plumbed but not yet an authz input.

### Memory slice (Decision #7c) — settled design, not yet built

The RBAC × Memory v2 design (agent-fs `research/2026-06-01-rbac-memory-options.md`: Option B, 3-column role-snapshot ownership `ownerUserId`+`ownerPrincipalId`+`ownerPrincipalType`, swarm/team/org scope) is the **reference impl for the row-level-reads surface** — but **none of it is merged**. `agent_memory` today is the pre-existing agent/swarm two-tier model with an **`isLead` bypass** (`src/be/memory/graph-expansion.ts:53`) that **contradicts** the memory design's "leads get requester perms, no bypass" decision. So the memory slice is: (a) designed + review-closed, (b) unbuilt, (c) requires removing the current lead bypass. Its named deps (Picateclas `7dd1c73d` attribution substrate, `workflow_runs.requestedByUserId`) remain prerequisites.

### Prompt-time tool filter (Decision #7b)

Single insertion point confirmed: `buildBasePrompt` (`src/prompts/base-prompt.ts`) already filters exposed tools/skills/MCP-servers by `hasMcp` / `role` (lead vs worker) / `capabilities` — an RBAC filter slots in alongside those checks (`:98-112`, `:165`, `:171`, `:262-281`).

### Net planning posture

The design is viable as-specified and the substrate is *more* built than assumed: enforcement-by-construction confirmed on both HTTP and MCP; a user-RBAC v0 (task ownership/visibility via `requestedByUserId`) is already live; the `isLead`→`can()` migration is a bounded 34-site list. Net-new build: the `roles`/`permissions`/`principal_roles` tables + `can()` engine + `permissions` fields on both factories + `user_api_keys` + audit log + memory-slice tables + dashboard. Ready for `/desplega:create-plan`.

## Incremental Delivery Strategy (2026-07-06)

The key enabler for incrementality: **separate enforcement plumbing (behavior-preserving, always-on) from the configurable role engine (opt-in).** Ship the plumbing first with zero behavior change, then layer the opt-in engine on top. Each increment is independently mergeable and independently valuable.

| # | Increment | New tables? | Behavior change? | Value shipped |
|---|---|---|---|---|
| **1** | **`can()` as a pure refactor** — one function encoding *today's exact rules* (34 lead gates + `assertOwnsTask` + kv/fs guards). Migrate all sites to call it. Characterization tests prove parity. **Includes closing the `scripts.ts:97,146` ungated-gap** (add the `isLead` check the OpenAPI already promises) as part of this migration. | No | **None** (parity) | Single chokepoint; audit-ready; live gap closed |
| **2** | **Audit log** — async/batched writer hung off `can()`. | audit only | None | Full observability, still no policy |
| **3** | **Role engine (opt-in)** — `roles`/`permissions`/`principal_roles` + `RBAC_ENABLED`. Seeded defaults *reproduce* increment-1 policy → enabling is a no-op until an admin customizes. | Yes (dormant) | Only when flag ON | Configurable roles + first-enable wizard |
| **4** | **Identity hardening** — `user_api_keys` + signed agent-context token replacing self-asserted `X-Agent-ID`. **MUST land before any role-based *agent* scoping is trusted** (else X-Agent-ID spoofing escalates). | Yes | Additive | Closes the spoofing vector; unblocks trusted agent RBAC |
| **5** | **Broader enforcement surfaces** — `permissions:[]` field on `route()` (covers whole HTTP surface) + prompt-time tool filter at `buildBasePrompt`. | No | Only when flag ON | Defense-in-depth + clean UX (agent never sees forbidden tools) |
| **6** | **Resource ACLs** — `channel_members`/`repo_access`/`agent_access`. Trusted agent-scoping depends on #4 having shipped. | Yes | Only when flag ON | Fine-grained per-resource scoping |

**Side-tracks:**
- **Memory slice** — the settled RBAC×Memory design (agent-fs `research/2026-06-01-rbac-memory-options.md`) runs as a **separate parallel workstream**, gated on its own deps (Picateclas `7dd1c73d`, `workflow_runs.requestedByUserId`) and requiring removal of the current `isLead` memory-bypass. Does NOT block the general increments.
- **Dashboard UX** (roles-first, Decision #12) — follows increment 3 once the tables exist.

### Resolved sequencing decisions (2026-07-06)

- **Disabled-mode `can()` = built-in legacy policy**, not allow-all (see refined Decision #1). This is what makes increment 1 a true no-op refactor.
- **`scripts.ts` gap folded into increment 1** (the `can()` migration), not shipped as a standalone bugfix.
- **Memory slice = parallel track**, gated on its external deps; general RBAC does not wait on it.
- **Identity hardening (increment 4) sequenced before trusted agent-scoping** (increments 5–6 for agents). User-RBAC (task/dashboard visibility) can progress on increments 1–3 without it, since user identity (`aswt_` token) is already authenticated; only *agent* self-assertion is the weak link.

Suggested first shippable slice = **increments 1 + 2** (central `can()` + audit, both behavior-preserving, no flag, no opt-in) — pure risk-reduction that makes everything after it additive.

### Constraints Identified

- **Must be opt-in / no-op when disabled.** Backwards compat is non-negotiable.
- **Self-hosted + cloud parity.** No cloud-only dependencies (e.g. an external IdP) as a hard requirement. Local SQLite + Bun must support the full RBAC story.
- **Permission registry is a TS source of truth.** UI catalogue and Zod validators both derive from it; no hand-maintained lists in the dashboard.
- **All check sites go through a single `can()` function.** Centralizes audit writing, intersection logic, and disabled-mode short-circuit.
- **Originator must be present for security-sensitive actions** when RBAC is on. Use the configured `default_unattributed_role` only as an explicit, audited fallback — not as a silent override.
- **No retroactive permission changes.** Revoking a permission cancels future actions only; in-flight chains continue under the originator's snapshot or pause per `on_user_deactivate` policy.
- **Hierarchical scopes / projects are explicitly out of scope** for v1. Resource ACLs cover the 80%.
- **The default global `API_KEY`** remains valid as a "system/admin" bearer for the runner, webhooks, and CLI in the transition window. Phasing out → optional in a later version.

### Core Requirements

1. New `rbac` module under `src/rbac/`:
   - `permissions.ts` — typed registry of every permission string + description + namespace.
   - `can.ts` — single `can(principal, verb, resource?)` function: handles enabled-flag short-circuit, principal-stack intersection, ACL lookup, audit write.
   - `roles.ts` — role CRUD + seed defaults.
   - `principals.ts` — uniform abstraction over user / agent / trigger-source.
2. New SQL migrations (forward-only, additive — safe with RBAC off):
   - `0NN_rbac_roles.sql` — `roles`, `permissions`, `role_permissions`, `principal_roles`.
   - `0NN_rbac_acls.sql` — `channel_members`, `repo_access`, `agent_access`.
   - `0NN_rbac_audit.sql` — `permission_audit`.
   - `0NN_rbac_user_credentials.sql` — `user_api_keys` (hashed, with `name`, `lastUsedAt`, `expiresAt`, `revokedAt`).
   - `0NN_rbac_trigger_sources.sql` — `trigger_sources` (or `roleId` columns on existing integration/schedule tables, whichever fits).
3. Route factory + MCP tool factory enhancements:
   - `route({ permissions: ['task.create'], ... })` in `src/http/route-def.ts`.
   - `defineTool({ permissions: [...], ... })` for MCP tools in `src/tools/*`.
4. Auth resolution:
   - Bearer token introspection that distinguishes: global `API_KEY` (legacy/admin), per-user API key (`user_api_keys`), agent-signed token. Each resolves to a principal.
   - OAuth callback flow → user-row link → API key issuance.
   - Slack/Linear webhook → existing `slackUserId` / `linearUserId` lookup → principal.
5. Originator propagation:
   - `agent_tasks.requestedByUserId` populated at every entry point (slack, github, linear, jira, CLI, dashboard, webhook, cron).
   - Child tasks (`send-task`) inherit parent's originator.
   - Lead/worker agent-context token carries originator for the task lifetime.
6. Tool-prompt filter:
   - `src/prompts/` computes effective permission set at prompt build → filters tools / skills / MCP servers / channels accordingly.
7. CLI:
   - `bun run src/cli.tsx rbac:bootstrap` — idempotent backfill (seed roles + permissive ACLs + assign current users).
   - `bun run src/cli.tsx rbac:issue-key --user-id <id> --name <name>` — admin tool for first key.
8. Dashboard pages (`ui/`):
   - `/settings/rbac/roles`, `/settings/rbac/permissions`, `/settings/rbac/api-keys`.
   - Inline "Access" panel on channel/agent/repo settings.
   - One-time enablement wizard.
9. Audit log:
   - Async/batched writer.
   - Retention cleanup task.
   - Audit-viewer UI page (admin) and "your activity" page (`audit.read.own`).
10. Acceptance scenarios (pipe-cleaners for QA / E2E):
    - Member-originated chain cannot escalate to `config.write` even through multiple agent hops.
    - Cron-originated chain runs under the trigger source's configured role.
    - Deactivated user pauses their in-flight chains (per config).
    - RBAC disabled → all today's behavior preserved, no audit writes.
    - First-time enable wizard correctly assigns existing users to default roles without locking out the enabler.

## Next Steps

- ✅ **DONE (2026-07-06):** codebase surfaces mapped in `thoughts/taras/research/2026-07-06-rbac-enforcement-surfaces.md` — every `route()` definition, MCP tool factory, prompt-assembly site, `agent_task` entry point, and `X-Agent-ID` consumer. Findings folded into the "2026-07-06 Refresh" + "Incremental Delivery Strategy" sections above.
- **Next:** `/desplega:create-plan` for phased delivery, using the 6-increment strategy (first shippable slice = increments 1+2: central `can()` + audit, behavior-preserving). Memory slice runs as a parallel track.

