import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "@/server";
import { closeDb } from "./be/db";
import {
  enqueueAuditRow,
  flushAuditBuffer,
  startAuditGc,
  startAuditWriter,
  stopAuditGc,
  stopAuditWriter,
} from "./be/rbac-audit";
import { clearAuditSink, setAuditSink } from "./rbac";

async function main() {
  // createServer() initializes the DB, so this standalone stdio transport OWNS
  // the database and serves the same gated tools as src/http — wire the RBAC
  // permission-audit sink here too (DES-445 Phase 6; plan "stdio blind spot").
  const server = createServer();
  setAuditSink(enqueueAuditRow);
  startAuditWriter();
  startAuditGc();

  const transport = new StdioServerTransport();

  await server.connect(transport);

  await server.sendLoggingMessage({
    level: "info",
    data: "MCP server connected via stdio",
  });
}

// NOTE: main() resolves right after the transport starts (the process stays
// alive on stdin), so `.finally` below runs post-boot — NOT at shutdown.
// getDb() lazily re-opens on the next query, which is why the existing
// closeDb() here is harmless. Audit teardown must therefore hang off process
// exit, where the synchronous final flush drains any buffered rows.
process.on("exit", () => {
  stopAuditGc();
  stopAuditWriter();
  flushAuditBuffer();
  clearAuditSink();
});

main()
  .catch(console.error)
  .finally(() => {
    closeDb();
  });
