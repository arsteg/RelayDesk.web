// Local dev Postgres for manual testing (port 5544, data dir .dev-pg). Safe to delete.
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const port = 5544;
const dir = path.resolve(".dev-pg");
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "relaydesk", password: "relaydesk", port, persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"] });

if (!fs.existsSync(path.join(dir, "PG_VERSION"))) await pg.initialise();
await pg.start();
for (const db of ["relaydesk", "relaydesk_test"]) {
  try { await pg.createDatabase(db); } catch { /* exists */ }
}
console.log(`DEV_PG_READY on localhost:${port} (relaydesk/relaydesk)`);
const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
