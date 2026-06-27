// @swarm/mcp-tool — MCP tool plumbing: the tool registrar (createToolRegistrar),
// request-context helpers (task-tool-ctx), the CORE/DEFERRED tool config, and the
// script-* MCP tool registrations (proxying the scripts API). Re-exports the live
// sources (now local under ./src after the Phase-3 extraction).
//
// No export-name collisions across the 10 modules — all flat. The other src/tools/*
// (api-server tools, Phase 6) stay in src/ and import these via @swarm/mcp-tool.

export * from "./src/tools/script-common";
export * from "./src/tools/script-delete";
export * from "./src/tools/script-query-types";
export * from "./src/tools/script-run";
export * from "./src/tools/script-runs";
export * from "./src/tools/script-search";
export * from "./src/tools/script-upsert";
export * from "./src/tools/task-tool-ctx";
export * from "./src/tools/tool-config";
export * from "./src/tools/utils";
