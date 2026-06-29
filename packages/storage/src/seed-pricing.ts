/**
 * Phase 2 of the cost-tracking plan: seed the API-owned `pricing` table.
 *
 * The package-level `@swarm/ai-pricing/seed-pricing` module is intentionally
 * DB-free. This wrapper owns the SQLite writes so database access remains
 * inside `src/be`.
 */

import { loadModelsDevCache } from "@swarm/ai-pricing/modelsdev-cache";
import { buildPricingSeedRows, type PricingSeedRow } from "@swarm/ai-pricing/seed-pricing";
import { getDb } from "./db";

/**
 * Idempotent — safe to call on every boot. Logs a one-line summary so
 * operators can tell whether the boot picked up new rates.
 */
export function seedPricingFromModelsDev(opts?: { quiet?: boolean }): {
  inserted: number;
  modelsdevFound: boolean;
} {
  const db = getDb();
  const cache = loadModelsDevCache();
  const allRows = buildPricingSeedRows(cache);

  const insert = db.prepare<null, [string, string, string, number]>(
    `INSERT OR IGNORE INTO pricing
       (provider, model, token_class, effective_from, price_per_million_usd, createdAt, lastUpdatedAt)
     VALUES (?, ?, ?, 0, ?, 0, 0)`,
  );

  let inserted = 0;
  const tx = db.transaction((rows: PricingSeedRow[]) => {
    for (const row of rows) {
      const result = insert.run(row.provider, row.model, row.tokenClass, row.pricePerMillionUsd);
      if (result.changes > 0) inserted += 1;
    }
  });
  tx(allRows);

  if (!opts?.quiet) {
    console.log(
      `[pricing] seed: ${inserted} new row(s); ${allRows.length} candidate(s); modelsdev=${
        cache ? "loaded" : "missing"
      }`,
    );
  }
  return { inserted, modelsdevFound: !!cache };
}
