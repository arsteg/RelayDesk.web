import Stripe from "stripe";
import { prisma, type Db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { appUrl } from "@/lib/email";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { billingEnabled } from "@/lib/features";
import { getPlan, planForStripePrice, TRIAL_DAYS } from "@/lib/plans";
import { Prisma } from "@/generated/prisma/client";
import type { Plan, SubscriptionStatus } from "@/generated/prisma/enums";
import { actorOf, assertCan, type TenantContext } from "@/server/context";
import { seatUsage } from "@/server/members";
import { monthlyOrderUsage } from "@/server/orders";

// ---------------------------------------------------------------------------
// Stripe client & mode
// ---------------------------------------------------------------------------

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient ??= new Stripe(key);
  return stripeClient;
}

/** The billing simulator is only available outside production and without Stripe keys. */
function assertBillingEnabled() {
  if (!billingEnabled()) throw new AppError("Billing is turned off for this deployment.", "BILLING_UNAVAILABLE");
}

export function isBillingSimulation(): boolean {
  return !process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV !== "production";
}

export async function getBillingOverview(ctx: TenantContext) {
  const sub = await prisma.subscription.findUnique({ where: { businessId: ctx.businessId } });
  const [seats, orders] = await Promise.all([seatUsage(prisma, ctx.businessId), monthlyOrderUsage(ctx)]);
  return {
    subscription: sub,
    plan: await getPlan(ctx.plan),
    seats,
    orders,
    access: ctx.access,
    mode: getStripe() ? ("stripe" as const) : isBillingSimulation() ? ("simulation" as const) : ("unconfigured" as const),
  };
}

// ---------------------------------------------------------------------------
// Checkout & portal (hosted by Stripe)
// ---------------------------------------------------------------------------

export async function createCheckoutSession(ctx: TenantContext, plan: Plan): Promise<string> {
  assertCan(ctx, "billing.manage");
  assertBillingEnabled();
  const stripe = getStripe();
  if (!stripe) throw new AppError("Stripe is not configured.", "BILLING_UNAVAILABLE");
  const price = (await getPlan(plan)).stripePriceId;
  if (!price) throw new AppError(`No Stripe price configured for the ${plan} plan.`, "BILLING_UNAVAILABLE");

  const sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: ctx.businessId } });
  if (sub.stripeSubscriptionId && sub.status !== "CANCELED") {
    throw new ValidationError("You already have a subscription. Use “Manage billing” to change plans.");
  }
  const customerId = await ensureStripeCustomer(stripe, ctx, sub.stripeCustomerId);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: ctx.businessId,
    line_items: [{ price, quantity: 1 }],
    metadata: { businessId: ctx.businessId, plan },
    subscription_data: { metadata: { businessId: ctx.businessId, plan } },
    success_url: appUrl("/app/settings/billing?checkout=success"),
    cancel_url: appUrl("/app/settings/billing?checkout=cancelled"),
  });
  await audit(prisma, {
    businessId: ctx.businessId,
    actor: actorOf(ctx),
    action: "subscription.checkout_started",
    entityType: "Subscription",
    entityId: sub.id,
    metadata: { plan },
  });
  if (!session.url) throw new AppError("Stripe did not return a checkout URL.", "BILLING_UNAVAILABLE");
  return session.url;
}

async function ensureStripeCustomer(stripe: Stripe, ctx: TenantContext, existing: string | null) {
  if (existing) return existing;
  const business = await prisma.business.findUniqueOrThrow({ where: { id: ctx.businessId }, select: { name: true, email: true } });
  const customer = await stripe.customers.create(
    { name: business.name, email: business.email ?? ctx.userEmail, metadata: { businessId: ctx.businessId } },
    { idempotencyKey: `customer-${ctx.businessId}` },
  );
  await prisma.subscription.update({ where: { businessId: ctx.businessId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

export async function createPortalSession(ctx: TenantContext): Promise<string> {
  assertCan(ctx, "billing.manage");
  assertBillingEnabled();
  const stripe = getStripe();
  if (!stripe) throw new AppError("Stripe is not configured.", "BILLING_UNAVAILABLE");
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: ctx.businessId } });
  if (!sub.stripeCustomerId) throw new ValidationError("Subscribe to a plan first.");
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: appUrl("/app/settings/billing"),
  });
  return session.url;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Verifies the Stripe-Signature header. Throws on an invalid signature. */
export function verifyStripeWebhook(rawBody: string, signature: string | null, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  if (!secret) throw new AppError("STRIPE_WEBHOOK_SECRET is not set.", "BILLING_UNAVAILABLE");
  if (!signature) throw new ValidationError("Missing Stripe-Signature header.");
  // constructEvent is a pure HMAC check; no API key needed.
  const verifier = getStripe() ?? new Stripe("sk_test_placeholder_for_webhook_verification");
  return verifier.webhooks.constructEvent(rawBody, signature, secret) as unknown as StripeEventLike;
}

/** Minimal shape of the Stripe objects we read - keeps processing easy to test. */
export interface StripeEventLike {
  id: string;
  type: string;
  created: number;
  data: { object: unknown };
}

interface StripeSubscriptionLike {
  id: string;
  customer: string | { id: string };
  status: string;
  metadata?: Record<string, string> | null;
  cancel_at_period_end?: boolean;
  canceled_at?: number | null;
  trial_end?: number | null;
  current_period_end?: number;
  items?: { data: { current_period_end?: number; price?: { id: string } }[] };
}

interface StripeCheckoutSessionLike {
  id: string;
  mode?: string;
  client_reference_id?: string | null;
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
}

export function mapStripeStatus(status: string): SubscriptionStatus | null {
  switch (status) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "unpaid":
      return "PAST_DUE";
    case "canceled":
    case "incomplete_expired":
      return "CANCELED";
    default:
      return null; // incomplete / paused: no change until Stripe resolves it
  }
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));
const toDate = (s: number | null | undefined) => (s ? new Date(s * 1000) : null);

export type WebhookResult = "processed" | "duplicate" | "ignored";

/**
 * Applies a verified Stripe event. Idempotent: each event id is recorded in
 * BillingEvent inside the same transaction as its effects, so retries and
 * duplicates are no-ops. Out-of-order subscription events are ignored using
 * the event's `created` timestamp.
 */
export async function processStripeEvent(event: StripeEventLike): Promise<WebhookResult> {
  return prisma.$transaction(async (tx) => {
    try {
      await tx.billingEvent.create({ data: { id: event.id, type: event.type } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "duplicate";
      throw err;
    }

    let businessId: string | null = null;
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as StripeCheckoutSessionLike;
        if (s.mode && s.mode !== "subscription") break;
        businessId = s.client_reference_id ?? s.metadata?.businessId ?? null;
        if (!businessId) break;
        const sub = await tx.subscription.findUnique({ where: { businessId } });
        if (!sub) {
          businessId = null;
          break;
        }
        await tx.subscription.update({
          where: { businessId },
          data: { stripeCustomerId: idOf(s.customer) ?? sub.stripeCustomerId, stripeSubscriptionId: idOf(s.subscription) ?? sub.stripeSubscriptionId },
        });
        await audit(tx, {
          businessId,
          actor: null,
          scope: "system",
          action: "subscription.checkout_completed",
          entityType: "Subscription",
          entityId: sub.id,
          metadata: { stripeEventId: event.id },
        });
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.resumed":
      case "customer.subscription.paused": {
        const s = event.data.object as StripeSubscriptionLike;
        businessId = await syncStripeSubscription(tx, s, event);
        break;
      }
      default:
        break;
    }
    await tx.billingEvent.update({ where: { id: event.id }, data: { businessId } });
    return businessId ? "processed" : "ignored";
  });
}

async function syncStripeSubscription(tx: Db, s: StripeSubscriptionLike, event: StripeEventLike): Promise<string | null> {
  const customerId = idOf(s.customer);
  // Prefer our stored ids; fall back to the metadata we set at checkout.
  const sub =
    (await tx.subscription.findUnique({ where: { stripeSubscriptionId: s.id } })) ??
    (customerId ? await tx.subscription.findUnique({ where: { stripeCustomerId: customerId } }) : null) ??
    (s.metadata?.businessId ? await tx.subscription.findUnique({ where: { businessId: s.metadata.businessId } }) : null);
  if (!sub) return null;

  const eventAt = new Date(event.created * 1000);
  if (sub.lastEventAt && eventAt < sub.lastEventAt) return sub.businessId; // stale, already superseded

  const status = event.type === "customer.subscription.deleted" ? "CANCELED" : mapStripeStatus(s.status);
  const item = s.items?.data?.[0];
  const plan = (await planForStripePrice(item?.price?.id)) ?? sub.plan;
  const periodEnd = toDate(item?.current_period_end ?? s.current_period_end);

  const data: Prisma.SubscriptionUpdateInput = {
    stripeSubscriptionId: s.id,
    stripeCustomerId: customerId ?? sub.stripeCustomerId,
    plan,
    cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
    currentPeriodEnd: periodEnd ?? sub.currentPeriodEnd,
    trialEndsAt: toDate(s.trial_end) ?? sub.trialEndsAt,
    lastEventAt: eventAt,
  };
  if (status) {
    data.status = status;
    data.pastDueSince = status === "PAST_DUE" ? (sub.pastDueSince ?? eventAt) : null;
    data.canceledAt = status === "CANCELED" ? (toDate(s.canceled_at) ?? eventAt) : null;
  }
  await tx.subscription.update({ where: { id: sub.id }, data });

  if (status !== sub.status || plan !== sub.plan) {
    await audit(tx, {
      businessId: sub.businessId,
      actor: null,
      scope: "system",
      action: "subscription.changed",
      entityType: "Subscription",
      entityId: sub.id,
      metadata: { from: { status: sub.status, plan: sub.plan }, to: { status: status ?? sub.status, plan }, stripeEventId: event.id },
    });
  }
  return sub.businessId;
}

// ---------------------------------------------------------------------------
// Development billing simulator (no Stripe credentials)
// ---------------------------------------------------------------------------

export type SimulationAction = "activate_starter" | "activate_pro" | "past_due" | "past_due_expired" | "cancel" | "restart_trial" | "expire_trial";

export async function simulateBilling(ctx: TenantContext, action: SimulationAction) {
  assertCan(ctx, "billing.manage");
  assertBillingEnabled();
  if (!isBillingSimulation()) throw new ForbiddenError("Billing simulation is only available in development without Stripe keys.");
  const now = new Date();
  const DAY = 86400_000;
  const updates: Record<SimulationAction, Prisma.SubscriptionUpdateInput> = {
    activate_starter: { plan: "STARTER", status: "ACTIVE", currentPeriodEnd: new Date(now.getTime() + 30 * DAY), pastDueSince: null, canceledAt: null, cancelAtPeriodEnd: false },
    activate_pro: { plan: "PRO", status: "ACTIVE", currentPeriodEnd: new Date(now.getTime() + 30 * DAY), pastDueSince: null, canceledAt: null, cancelAtPeriodEnd: false },
    past_due: { status: "PAST_DUE", pastDueSince: now },
    past_due_expired: { status: "PAST_DUE", pastDueSince: new Date(now.getTime() - 30 * DAY) },
    cancel: { status: "CANCELED", canceledAt: now, currentPeriodEnd: now },
    restart_trial: { plan: "PRO", status: "TRIALING", trialEndsAt: new Date(now.getTime() + TRIAL_DAYS() * DAY), pastDueSince: null, canceledAt: null },
    expire_trial: { status: "TRIALING", trialEndsAt: new Date(now.getTime() - DAY) },
  };
  await prisma.$transaction(async (tx) => {
    const before = await tx.subscription.findUniqueOrThrow({ where: { businessId: ctx.businessId } });
    const after = await tx.subscription.update({ where: { businessId: ctx.businessId }, data: updates[action] });
    await audit(tx, {
      businessId: ctx.businessId,
      actor: actorOf(ctx),
      action: "subscription.simulated",
      entityType: "Subscription",
      entityId: after.id,
      metadata: { simulation: action, from: { status: before.status, plan: before.plan }, to: { status: after.status, plan: after.plan } },
    });
  });
}
