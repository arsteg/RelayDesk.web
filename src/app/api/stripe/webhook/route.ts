import { processStripeEvent, verifyStripeWebhook } from "@/server/billing";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook endpoint. The raw body is verified against the signature
 * before anything is processed; processing is idempotent per event id.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let event;
  try {
    event = verifyStripeWebhook(raw, req.headers.get("stripe-signature"));
  } catch (err) {
    console.warn("[stripe] rejected webhook:", (err as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }
  try {
    const result = await processStripeEvent(event);
    return Response.json({ received: true, result });
  } catch (err) {
    console.error("[stripe] webhook processing failed", event.id, err);
    // 500 makes Stripe retry; the idempotency record was rolled back with the transaction.
    return new Response("Processing failed", { status: 500 });
  }
}
