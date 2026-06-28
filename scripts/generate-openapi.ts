import { generateOpenApiSpec } from "../packages/api-server/src/http/openapi";
// Import all handler files to trigger route() registrations.
// NOTE: order is load-bearing — the route registry is an insertion-ordered array
// and the emitted spec preserves it, so keep this list (and its grouping) stable
// to keep openapi.json byte-identical. These reach the moved handlers by path
// (not the @swarm/api-server barrel) so the module-evaluation order is preserved.
import "../packages/api-server/src/http/active-sessions";
import "../packages/api-server/src/http/agents";
import "../packages/api-server/src/http/approval-requests";
import "../packages/api-server/src/http/budgets";
import "../packages/api-server/src/http/config";
import "../packages/api-server/src/http/context";
import "../packages/api-server/src/http/db-query";
import "../packages/api-server/src/http/ecosystem";

import "../packages/api-server/src/http/api-keys";
import "../packages/api-server/src/http/events";
import "../packages/api-server/src/http/heartbeat";
import "../packages/api-server/src/http/inbox-state";
import "../packages/api-server/src/http/integrations";
import "../packages/api-server/src/http/kv";
import "../packages/api-server/src/http/memory";
import "../packages/api-server/src/http/page-proxy";
import "../packages/api-server/src/http/pages";
import "../packages/api-server/src/http/pages-public";
import "../packages/api-server/src/http/prompt-templates";
import "../packages/api-server/src/http/poll";
import "../packages/api-server/src/http/pricing";
import "../packages/api-server/src/http/repos";
import "../packages/api-server/src/http/schedules";
import "../packages/api-server/src/http/script-runs";
import "../packages/api-server/src/http/session-data";
import "../packages/api-server/src/http/sessions";
import "../packages/api-server/src/http/skills";
import "../packages/api-server/src/http/scripts";
import "../packages/api-server/src/http/mcp-bridge";
import "../packages/api-server/src/http/mcp-oauth";
import "../packages/api-server/src/http/mcp-servers";
import "../packages/api-server/src/http/stats";
import "../packages/api-server/src/http/status";
import "../packages/api-server/src/http/tasks";
import "../packages/api-server/src/http/task-templates";
import "../packages/api-server/src/http/trackers/jira";
import "../packages/api-server/src/http/trackers/linear";
import "../packages/api-server/src/http/users";
import "../packages/api-server/src/http/webhooks";
import "../packages/api-server/src/http/workflow-events";
import "../packages/api-server/src/http/workflows";

const version = (await Bun.file("package.json").json()).version;
const spec = generateOpenApiSpec({ version, serverUrl: "http://localhost:3013" });
await Bun.write("openapi.json", spec);
console.log(`Generated openapi.json (${(spec.length / 1024).toFixed(1)}KB)`);

// Auto-generate docs-site API reference from the new spec
await Bun.$`bun docs-site/scripts/generate-docs.ts`;
