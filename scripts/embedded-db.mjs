/**
 * No-Docker fallback for local development: runs a real PostgreSQL server
 * from the `embedded-postgres` npm package with the same port, user and
 * databases as docker-compose.yml, so the default .env works unchanged.
 *
 *   npm run db:embedded        (Ctrl+C to stop; data persists in .embedded-pg/)
 *
 * Docker Compose remains the recommended setup.
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.env.EMBEDDED_PG_PORT ?? 5432);
const dir = path.resolve(".embedded-pg");
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "relaydesk", password: "relaydesk", port, persistent: true });

if (!fs.existsSync(path.join(dir, "PG_VERSION"))) await pg.initialise();
await pg.start();
for (const db of ["relaydesk", "relaydesk_test"]) {
  try {
    await pg.createDatabase(db);
  } catch {
    /* already exists */
  }
}
console.log(`PostgreSQL ready on localhost:${port} (user/password: relaydesk). Ctrl+C to stop.`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
