import "dotenv/config";
import { runDailyJobs } from "../src/server/jobs";
import { prisma } from "../src/lib/db";

runDailyJobs()
  .then((r) => console.log("[jobs] done", r))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
