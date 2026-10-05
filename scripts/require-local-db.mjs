// Refuses to continue unless DATABASE_URL points at a local database.
// Guards destructive development commands (db:reset, db:migrate) because the
// local .env may point at the production database.
import "dotenv/config";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db"]);

let host = "";
try {
  host = new URL(process.env.DATABASE_URL ?? "").hostname;
} catch {
  // fall through: an unparsable URL is not treated as local
}

if (!LOCAL_HOSTS.has(host) && process.env.ALLOW_REMOTE_DB !== "1") {
  console.error(
    `Refusing to run: DATABASE_URL points at "${host || "an invalid URL"}", not a local database.\n` +
      "This command can delete data. Run it against a local database, e.g.\n" +
      "  npm run db:embedded   (in another terminal), then\n" +
      "  DATABASE_URL=postgresql://relaydesk:relaydesk@localhost:5432/relaydesk npm run <command>\n" +
      "Set ALLOW_REMOTE_DB=1 only if you are sure.",
  );
  process.exit(1);
}
