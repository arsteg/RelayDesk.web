import { timingSafeEqual } from "node:crypto";
import { runDailyJobs } from "@/server/jobs";

export const dynamic = "force-dynamic";

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || secret === "change-me") return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Trigger daily jobs from an external scheduler: POST with `Authorization: Bearer $CRON_SECRET`. */
export async function POST(req: Request) {
  if (!authorised(req)) return new Response("Unauthorized", { status: 401 });
  const result = await runDailyJobs();
  return Response.json(result);
}
