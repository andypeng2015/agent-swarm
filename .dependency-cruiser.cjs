const dbFreePackages =
  "^packages/(types|core-utils|otel|ai-pricing|credentials|prompt-templates|artifacts|scripts|api-client|e2b-dispatch|swarm-templates|ai-llm|mcp-tool|harness)(/|$)";
const dbFreeApps = "^apps/(cli|ui|templates-ui|evals)(/|$)";
const dbFreeLegacyWorkerPaths = "^src/(cli\\.tsx|hooks/|prompts/|utils/)";

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "db-free-code-does-not-import-db-owners",
      severity: "error",
      comment:
        "Workers and DB-free packages must call the API over HTTP instead of importing storage/workflows or legacy src/be modules.",
      from: {
        path: `(${dbFreePackages}|${dbFreeApps}|${dbFreeLegacyWorkerPaths}|^plugin/opencode-plugins/)`,
      },
      to: {
        path: "^(packages/(storage|workflows)(/|$)|src/be(/|$))",
      },
    },
    {
      name: "sqlite-driver-stays-server-side",
      severity: "error",
      comment: "Only storage and API-server code may import the raw SQLite driver.",
      from: {
        pathNot: "^(packages/(storage|api-server)(/|$)|apps/api(/|$)|src/tests/)",
      },
      to: {
        path: "^bun:sqlite$",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules|\\.next|dist|coverage",
    },
    tsConfig: {
      fileName: "./tsconfig.json",
    },
  },
};
