import { checkEnv } from "@/lib/env";

/** Node-only startup checks (kept out of instrumentation.ts so Edge builds stay clean). */
export function validateConfigOrExit() {
  const { errors, warnings } = checkEnv();
  for (const w of warnings) console.warn(`[config] ${w}`);
  if (!errors.length) return;
  for (const e of errors) console.error(`[config] ${e}`);
  if (process.env.NODE_ENV === "production") {
    // Exit instead of serving 500s, so the deploy fails visibly and the
    // orchestrator keeps the previous healthy version running.
    console.error(`[config] Invalid configuration (${errors.length} error${errors.length > 1 ? "s" : ""}); refusing to start.`);
    process.exit(1);
  }
}
