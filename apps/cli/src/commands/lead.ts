import { getEnabledCapabilities } from "@swarm/core-utils/capabilities";
import { type RunnerConfig, type RunnerOptions, runAgent } from "./runner.ts";

export type LeadOptions = RunnerOptions;

const leadConfig: RunnerConfig = {
  role: "lead",
  defaultPrompt: "/start-leader",
  metadataType: "lead_metadata",
  capabilities: getEnabledCapabilities(),
};

export async function runLead(opts: LeadOptions) {
  return runAgent(leadConfig, opts);
}
