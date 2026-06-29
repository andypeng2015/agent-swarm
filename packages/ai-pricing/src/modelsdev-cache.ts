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

export const MODELSDEV_CACHE_PATH = path.join(
  "packages",
  "ai-pricing",
  "src",
  "modelsdev-cache.json",
);
const LEGACY_MODELSDEV_CACHE_PATH = path.join("src", "be", "modelsdev-cache.json");

/**
 * Resolve the vendored models.dev cache from source checkouts and compiled
 * Docker images. The API image copies the snapshot to `/app/packages/...`.
 *
 * This file is now fallback-only for pricing freshness: boot seeding uses it
 * when the DB is empty or models.dev is unavailable, while API-side
 * `src/be/pricing-refresh.ts` owns live price updates.
 */
export function loadModelsDevCache(): ModelsDevCache | null {
  const explicitPath = process.env.MODELSDEV_CACHE_PATH;
  const candidates = [
    ...(explicitPath ? [explicitPath] : []),
    path.join(process.cwd(), MODELSDEV_CACHE_PATH),
    path.join(process.cwd(), "..", MODELSDEV_CACHE_PATH),
    path.join("/app", MODELSDEV_CACHE_PATH),
    path.join(process.cwd(), LEGACY_MODELSDEV_CACHE_PATH),
    path.join(process.cwd(), "..", LEGACY_MODELSDEV_CACHE_PATH),
    path.join("/app", LEGACY_MODELSDEV_CACHE_PATH),
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
