import { verifyRazorpayWebhook } from "@/lib/razorpay";
import { processRazorpaySubscriptionEvent } from "@/server/razorpay-billing";

export const dynamic = "force-dynamic";

/**
 * Razorpay webhook for PLATFORM SaaS billing (supplier subscriptions). The raw
 * body is verified against RAZORPAY_WEBHOOK_SECRET before processing;
 * processing is idempotent per Razorpay event id.
 *
 * (End-customer order-payment webhooks are handled per-supplier by the FastAPI
 * backend, which verifies against each business's own webhook secret.)
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  if (!verifyRazorpayWebhook(raw, signature, process.env.RAZORPAY_WEBHOOK_SECRET)) {
    return new Response("Invalid signature", { status: 400 });
  }

  let payload: { event?: string; payload?: { subscription?: { entity?: Record<string, unknown> } } };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const eventName = payload.event ?? "";
  const eventId = req.headers.get("x-razorpay-event-id") ?? `${eventName}:${Date.now()}`;
  const entity = payload.payload?.subscription?.entity;

  // We only act on subscription lifecycle events; acknowledge the rest.
  if (!eventName.startsWith("subscription.") || !entity) {
    return Response.json({ received: true, result: "ignored" });
  }

  try {
    const result = await processRazorpaySubscriptionEvent(eventId, eventName, entity as never);
    return Response.json({ received: true, result });
  } catch (err) {
    console.error("[razorpay] webhook processing failed", eventId, err);
    return new Response("Processing failed", { status: 500 });
  }
}
