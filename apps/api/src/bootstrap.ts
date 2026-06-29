import { registerGithubTaskReactions } from "@swarm/integrations/github/task-reactions";
import { initDb } from "@swarm/storage/db";
import { startPricingRefreshLoop } from "@swarm/storage/pricing-refresh";
import { seedPricingFromModelsDev } from "@swarm/storage/seed-pricing";

let bootstrapped = false;

export function bootstrapApi(options: { databasePath?: string } = {}) {
  if (bootstrapped) return;

  // Initialize database with WAL mode. DATABASE_PATH keeps Docker's .sqlite,
  // .sqlite-wal, and .sqlite-shm files on the same mounted filesystem.
  initDb(options.databasePath ?? process.env.DATABASE_PATH);

  // Project the vendored models.dev snapshot into the pricing table before the
  // API starts serving cost recomputation routes.
  seedPricingFromModelsDev();
  startPricingRefreshLoop();

  // Subscribe API-side integrations to task-lifecycle events. Idempotent.
  registerGithubTaskReactions();

  bootstrapped = true;
}
