#!/usr/bin/env bun

import { $ } from "bun";

const APP_DIR = "/opt/agent-swarm";
const SCRIPT_DIR = import.meta.dir;
const PROJECT_DIR = `${SCRIPT_DIR}/..`;

console.log("Updating agent-swarm...");

// Copy project files
await $`cp -r ${PROJECT_DIR}/src ${APP_DIR}/`;
await $`cp ${PROJECT_DIR}/package.json ${PROJECT_DIR}/bun.lock ${PROJECT_DIR}/bunfig.toml ${PROJECT_DIR}/tsconfig.json ${APP_DIR}/`;

// The root manifest declares Bun workspaces, so a frozen install needs every member's
// package.json present to resolve the workspace graph (manifests only — no member code).
await $`mkdir -p ${APP_DIR}/ui ${APP_DIR}/templates-ui ${APP_DIR}/evals`;
await $`cp ${PROJECT_DIR}/ui/package.json ${APP_DIR}/ui/`;
await $`cp ${PROJECT_DIR}/templates-ui/package.json ${APP_DIR}/templates-ui/`;
await $`cp ${PROJECT_DIR}/evals/package.json ${APP_DIR}/evals/`;

// Install dependencies
await $`cd ${APP_DIR} && bun install --frozen-lockfile --production`;

// Restart service
await $`systemctl restart agent-swarm`;

console.log("Updated and restarted.");
