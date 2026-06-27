// @swarm/prompt-templates — system/task prompt-template registry + resolver (DB-free;
// DB lookups are injected via configureDbResolver). Phase-2: real sources live in ./src;
// consumers import "@swarm/prompt-templates".
export * from "./src/heartbeat/templates";
export * from "./src/prompts/base-prompt";
export * from "./src/prompts/defaults";
export * from "./src/prompts/memories";
export * from "./src/prompts/registry";
export * from "./src/prompts/resolver";
export * from "./src/prompts/session-templates";
