const DEFAULT_CAPABILITIES =
  "core,task-pool,profiles,services,scheduling,memory,workflows,pages,metrics,kv";

function getCapabilitySet(): Set<string> {
  return new Set(
    (process.env.CAPABILITIES || DEFAULT_CAPABILITIES).split(",").map((s) => s.trim()),
  );
}

export function hasCapability(cap: string): boolean {
  return getCapabilitySet().has(cap);
}

export function getEnabledCapabilities(): string[] {
  return Array.from(getCapabilitySet());
}
