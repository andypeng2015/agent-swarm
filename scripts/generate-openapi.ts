import { generateOpenApiSpec } from "@swarm/api-server/http/openapi";
// Import all handler files to trigger route() registrations
import "@swarm/api-server/http/active-sessions";
import "@swarm/api-server/http/agents";
import "@swarm/api-server/http/approval-requests";
import "@swarm/api-server/http/budgets";
import "@swarm/api-server/http/config";
import "@swarm/api-server/http/context";
import "@swarm/api-server/http/db-query";
import "@swarm/api-server/http/ecosystem";

import "@swarm/api-server/http/api-keys";
import "@swarm/api-server/http/events";
import "@swarm/api-server/http/heartbeat";
import "@swarm/api-server/http/inbox-state";
import "@swarm/api-server/http/integrations";
import "@swarm/api-server/http/kv";
import "@swarm/api-server/http/memory";
import "@swarm/api-server/http/page-proxy";
import "@swarm/api-server/http/pages";
import "@swarm/api-server/http/pages-public";
import "@swarm/api-server/http/prompt-templates";
import "@swarm/api-server/http/poll";
import "@swarm/api-server/http/pricing";
import "@swarm/api-server/http/repos";
import "@swarm/api-server/http/schedules";
import "@swarm/api-server/http/script-runs";
import "@swarm/api-server/http/session-data";
import "@swarm/api-server/http/sessions";
import "@swarm/api-server/http/skills";
import "@swarm/api-server/http/scripts";
import "@swarm/api-server/http/mcp-bridge";
import "@swarm/api-server/http/mcp-oauth";
import "@swarm/api-server/http/mcp-servers";
import "@swarm/api-server/http/stats";
import "@swarm/api-server/http/status";
import "@swarm/api-server/http/tasks";
import "@swarm/api-server/http/task-templates";
import "@swarm/api-server/http/trackers/jira";
import "@swarm/api-server/http/trackers/linear";
import "@swarm/api-server/http/users";
import "@swarm/api-server/http/webhooks";
import "@swarm/api-server/http/workflow-events";
import "@swarm/api-server/http/workflows";

const CLI_PACKAGE_JSON = "apps/cli/package.json";

const version = (await Bun.file(CLI_PACKAGE_JSON).json()).version;
const spec = generateOpenApiSpec({ version, serverUrl: "http://localhost:3013" });
await Bun.write("openapi.json", spec);
console.log(`Generated openapi.json (${(spec.length / 1024).toFixed(1)}KB)`);

// Auto-generate docs-site API reference from the new spec
await Bun.$`bun docs-site/scripts/generate-docs.ts`;
