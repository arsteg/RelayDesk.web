import { getTenant } from "@/lib/auth/current";
import { getLogo } from "@/server/settings";

/** Serves the current workspace's logo (tenant from session, never from the URL). */
export async function GET() {
  const ctx = await getTenant();
  const logo = await getLogo(ctx);
  if (!logo?.logoData || !logo.logoMimeType) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.logoData), {
    headers: {
      "Content-Type": logo.logoMimeType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
