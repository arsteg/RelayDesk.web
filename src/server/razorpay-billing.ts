import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { billingEnabled } from "@/lib/features";
import { razorpayConfigured, razorpayRequest } from "@/lib/razorpay";
import { Prisma } from "@/generated/prisma/client";
import type { Plan, SubscriptionStatus } from "@/generated/prisma/enums";
import { actorOf, assertCan, type TenantContext } from "@/server/context";

/**
 * SaaS billing on the PLATFORM's Razorpay account: suppliers subscribe to a
 * RelayDesk plan. End-customers never pay here (that is per-supplier, elsewhere).
 */

interface RazorpaySubscription {
  id: string;
  status: string;
  short_url?: string;
  current_end?: number | null;
  customer_id?: string | null;
}

/** Create a Razorpay subscription for a plan and return the hosted checkout URL. */
export async function createRazorpaySubscription(ctx: TenantContext, plan: Plan): Promise<string> {
  assertCan(ctx, "billing.manage");
  if (!billingEnabled()) throw new AppError("Billing is turned off for this deployment.", "BILLING_UNAVAILABLE");
  if (!razorpayConfigured()) throw new AppError("Razorpay is not configured.", "BILLING_UNAVAILABLE");

  const planRow = await prisma.pricingPlan.findUnique({ where: { code: plan }, select: { razorpayPlanId: true } });
  if (!planRow?.razorpayPlanId) throw new AppError(`No Razorpay plan configured for the ${plan} plan.`, "BILLING_UNAVAILABLE");

  const sub = await razorpayRequest<RazorpaySubscription>("POST", "/subscriptions", {
    plan_id: planRow.razorpayPlanId,
    total_count: 120, // up to 120 billing cycles; Razorpay requires a bound
    customer_notify: 1,
    notes: { businessId: ctx.businessId, plan },
  });

  await prisma.subscription.update({ where: { businessId: ctx.businessId }, data: { razorpaySubscriptionId: sub.id } });
  await audit(prisma, { businessId: ctx.businessId, actor: actorOf(ctx), action: "subscription.checkout_started", entityType: "Subscription", entityId: ctx.businessId, metadata: { provider: "razorpay", plan } });

  if (!sub.short_url) throw new AppError("Razorpay did not return a checkout URL.", "BILLING_UNAVAILABLE");
  return sub.short_url;
}

/** Razorpay subscription state -> our SubscriptionStatus (null = leave unchanged). */
function mapStatus(rzpStatus: string): SubscriptionStatus | null {
  switch (rzpStatus) {
    case "active":
    case "authenticated":
    case "charged":
    case "resumed":
      return "ACTIVE";
    case "pending":
    case "halted":
    case "paused":
      return "PAST_DUE";
    case "cancelled":
    case "completed":
    case "expired":
      return "CANCELED";
    default:
      return null; // created / updated / etc.
  }
}

/**
 * Apply a Razorpay subscription webhook event. Idempotent via the BillingEvent
 * ledger (keyed on Razorpay's event id). Returns "processed" | "duplicate" | "ignored".
 */
export async function processRazorpaySubscriptionEvent(
  eventId: string,
  eventName: string,
  entity: RazorpaySubscription,
): Promise<"processed" | "duplicate" | "ignored"> {
  return prisma.$transaction(async (tx) => {
    try {
      await tx.billingEvent.create({ data: { id: eventId, type: eventName } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
      throw e;
    }

    const sub = await tx.subscription.findFirst({ where: { razorpaySubscriptionId: entity.id } });
    if (!sub) return "ignored";

    const status = mapStatus(entity.status);
    const data: Prisma.SubscriptionUpdateInput = { lastEventAt: new Date() };
    if (status) data.status = status;
    if (entity.current_end) data.currentPeriodEnd = new Date(entity.current_end * 1000);
    if (entity.customer_id) data.razorpayCustomerId = entity.customer_id;
    if (status === "CANCELED") data.canceledAt = new Date();
    if (status === "PAST_DUE" && !sub.pastDueSince) data.pastDueSince = new Date();
    if (status === "ACTIVE") {
      data.pastDueSince = null;
      data.canceledAt = null;
    }

    await tx.subscription.update({ where: { id: sub.id }, data });
    await tx.billingEvent.update({ where: { id: eventId }, data: { businessId: sub.businessId } });
    await audit(tx, { businessId: sub.businessId, actor: null, action: "subscription.changed", entityType: "Subscription", entityId: sub.businessId, metadata: { provider: "razorpay", event: eventName, status } });
    return "processed";
  });
}
