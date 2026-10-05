import { getTenant } from "@/lib/auth/current";
import { AppError } from "@/lib/errors";
import { zonedDateString } from "@/lib/time";
import { exportCsv, type ExportKind } from "@/server/exports";

const KINDS: ExportKind[] = ["clients", "orders", "payments"];

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!KINDS.includes(kind as ExportKind)) return new Response("Unknown export", { status: 404 });
  const ctx = await getTenant();
  try {
    const csv = await exportCsv(ctx, kind as ExportKind);
    const slug = ctx.business.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
    const filename = `${slug}-${kind}-${zonedDateString(new Date(), ctx.business.timezone)}.csv`;
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.code === "FORBIDDEN" ? 403 : 400 });
    throw err;
  }
}
