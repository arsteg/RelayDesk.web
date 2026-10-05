import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` runs on every install (postinstall) and needs no database
// connection, yet the Prisma config loader resolves `datasource.url` eagerly.
// Fall back to a placeholder so installs/builds that don't set DATABASE_URL
// (e.g. the Netlify build step) still succeed. Real CLI commands
// (migrate/deploy/seed) and the app runtime (src/lib/db.ts) use the actual
// DATABASE_URL from the environment and fail loudly if it is missing.
const url = process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url },
});
