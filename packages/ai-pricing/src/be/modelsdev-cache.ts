import { readFileSync } from "node:fs";
import path from "node:path";

export interface ModelsDevCostBlock {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface ModelsDevModel {
  id?: string;
  cost?: ModelsDevCostBlock;
}

export interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
}

export type ModelsDevCache = Record<string, ModelsDevProvider>;

export const MODELSDEV_CACHE_PATH = path.join("src", "be", "modelsdev-cache.json");

/**
 * Resolve the vendored models.dev cache from source checkouts and compiled
 * Docker images. The snapshot now lives alongside this module in
 * `@swarm/ai-pricing` (`packages/ai-pricing/src/be/modelsdev-cache.json`); the
 * API image copies it to `/app/src/be/...` for the compiled binary.
 *
 * Resolution order: (1) explicit `MODELSDEV_CACHE_PATH` override, (2) the
 * snapshot co-located with this module via `import.meta.dir` — the reliable
 * path for local dev + tests regardless of cwd, (3) cwd-relative legacy paths,
 * (4) the `/app/src/be/...` copy used inside the compiled Docker image (where
 * `import.meta.dir` points at the bunfs virtual root and falls through).
 *
 * This file is now fallback-only for pricing freshness: boot seeding uses it
 * when the DB is empty or models.dev is unavailable, while
 * `src/be/pricing-refresh.ts` owns live price updates. The UI model picker
 * still imports the same snapshot for names, labels, and context windows.
 */
export function loadModelsDevCache(): ModelsDevCache | null {
  const explicitPath = process.env.MODELSDEV_CACHE_PATH;
  const candidates = [
    ...(explicitPath ? [explicitPath] : []),
    path.join(import.meta.dir, "modelsdev-cache.json"),
    path.join(process.cwd(), MODELSDEV_CACHE_PATH),
    path.join(process.cwd(), "..", MODELSDEV_CACHE_PATH),
    path.join("/app", MODELSDEV_CACHE_PATH),
  ];

  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf-8")) as ModelsDevCache;
    } catch {
      // try next candidate
    }
  }

  return null;
}
