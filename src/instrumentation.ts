import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { validateConfigOrExit } = await import("./instrumentation-node");
    validateConfigOrExit();
  }
}

/** One structured log line per unhandled server error (pages, actions, route handlers). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  console.error(
    JSON.stringify({
      level: "error",
      msg: "request_error",
      digest: e.digest,
      error: e.message,
      stack: e.stack?.split("\n").slice(0, 6).join("\n"),
      method: request.method,
      path: request.path,
      routePath: context.routePath,
      routeType: context.routeType,
      at: new Date().toISOString(),
    }),
  );
};
