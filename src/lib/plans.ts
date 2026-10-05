import type { Plan, SubscriptionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { billingEnabled } from "@/lib/features";

export interface PlanDefinition {
  id: Plan;
  name: string;
  description: string;
  priceLabel: string;
  maxMembers: number | null; // includes owner and pending invitations; null = unlimited
  maxMonthlyOrders: number | null; // orders created per calendar month; null = unlimited
  stripePriceId: string | undefined;
}

function envLimit(name: string, fallback: number | null): number | null {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Built-in defaults (with env overrides). These are the source of truth until an
 * operator edits the `PricingPlan` rows, and remain the fallback if the table is
 * empty or unreachable, so the app can never regress from the DB-backed path.
 */
export function getDefaultPlans(): Record<Plan, PlanDefinition> {
  return {
    STARTER: {
      id: "STARTER",
      name: "Starter",
      description: "For solo owners and small teams getting started.",
      priceLabel: process.env.PLAN_STARTER_PRICE_LABEL ?? "₹999 / month",
      maxMembers: envLimit("PLAN_STARTER_MAX_MEMBERS", 3),
      maxMonthlyOrders: envLimit("PLAN_STARTER_MAX_MONTHLY_ORDERS", 200),
      stripePriceId: process.env.STRIPE_PRICE_STARTER || undefined,
    },
    PRO: {
      id: "PRO",
      name: "Pro",
      description: "For busy teams that need more seats and unlimited orders.",
      priceLabel: process.env.PLAN_PRO_PRICE_LABEL ?? "₹2,499 / month",
      maxMembers: envLimit("PLAN_PRO_MAX_MEMBERS", 25),
      maxMonthlyOrders: envLimit("PLAN_PRO_MAX_MONTHLY_ORDERS", null),
      stripePriceId: process.env.STRIPE_PRICE_PRO || undefined,
    },
  };
}

/**
 * Plan definitions, read from the operator-editable `PricingPlan` table and
 * merged over the built-in defaults. A plan whose row is absent keeps its
 * default; any DB/table error falls back to defaults entirely.
 */
export async function getPlans(): Promise<Record<Plan, PlanDefinition>> {
  const defaults = getDefaultPlans();
  try {
    const rows = await prisma.pricingPlan.findMany();
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const out = { ...defaults };
    for (const id of Object.keys(out) as Plan[]) {
      const row = byCode.get(id);
      if (!row) continue;
      out[id] = {
        id,
        name: row.name,
        description: row.description,
        priceLabel: row.priceLabel,
        maxMembers: row.maxMembers, // null = unlimited
        maxMonthlyOrders: row.maxMonthlyOrders, // null = unlimited
        stripePriceId: row.stripePriceId ?? defaults[id].stripePriceId,
      };
    }
    return out;
  } catch {
    return defaults;
  }
}

export async function getPlan(plan: Plan): Promise<PlanDefinition> {
  return (await getPlans())[plan];
}

export async function planForStripePrice(priceId: string | null | undefined): Promise<Plan | null> {
  if (!priceId) return null;
  const plans = await getPlans();
  for (const p of Object.values(plans)) if (p.stripePriceId === priceId) return p.id;
  return null;
}

export const TRIAL_DAYS = () => Number(process.env.TRIAL_DAYS ?? 14);
export const PAST_DUE_GRACE_DAYS = () => Number(process.env.PAST_DUE_GRACE_DAYS ?? 7);
/** Plan granted while trialling (trial users get the full feature set). */
export const TRIAL_PLAN: Plan = "PRO";

export type AccessLevel = "full" | "readonly" | "suspended";

export interface WorkspaceAccess {
  level: AccessLevel;
  /** Why the workspace is not fully usable. */
  reason: string | null;
  /** Non-blocking warning, e.g. trial ending or grace period. */
  warning: string | null;
}

export interface SubscriptionLike {
  plan: Plan;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Access policy
 * - Suspended by platform admin  -> blocked (owners can still export data).
 * - TRIALING before trialEndsAt  -> full.  After -> read-only until subscribed.
 * - ACTIVE                       -> full.
 * - PAST_DUE                     -> full during PAST_DUE_GRACE_DAYS, then read-only.
 * - CANCELED                     -> full until currentPeriodEnd, then read-only.
 * Read-only keeps every record visible and exportable; it blocks creating or
 * changing business data until a subscription is active again.
 * With billing disabled, every workspace that is not suspended has full access.
 */
export function computeAccess(
  sub: SubscriptionLike | null,
  business: { suspendedAt: Date | null; suspendedReason?: string | null },
  now = new Date(),
): WorkspaceAccess {
  if (business.suspendedAt) {
    return {
      level: "suspended",
      reason: `This workspace has been suspended by RelayDesk support${business.suspendedReason ? `: ${business.suspendedReason}` : "."} Owners can still export data.`,
      warning: null,
    };
  }
  if (!billingEnabled()) return { level: "full", reason: null, warning: null };
  if (!sub) return { level: "readonly", reason: "No subscription found. Choose a plan to continue.", warning: null };

  switch (sub.status) {
    case "TRIALING": {
      if (sub.trialEndsAt && sub.trialEndsAt > now) {
        const days = Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY);
        return { level: "full", reason: null, warning: days <= 5 ? `Your free trial ends in ${days} day${days === 1 ? "" : "s"}.` : null };
      }
      return { level: "readonly", reason: "Your free trial has ended. Choose a plan to keep creating orders.", warning: null };
    }
    case "ACTIVE":
      return { level: "full", reason: null, warning: null };
    case "PAST_DUE": {
      const since = sub.pastDueSince ?? now;
      const graceEnd = new Date(since.getTime() + PAST_DUE_GRACE_DAYS() * DAY);
      if (graceEnd > now) {
        return {
          level: "full",
          reason: null,
          warning: `Your last subscription payment failed. Update your payment method before ${graceEnd.toDateString()} to avoid read-only mode.`,
        };
      }
      return { level: "readonly", reason: "Your subscription payment is overdue. Update billing to restore full access.", warning: null };
    }
    case "CANCELED": {
      if (sub.currentPeriodEnd && sub.currentPeriodEnd > now) {
        return { level: "full", reason: null, warning: `Your subscription is cancelled and ends on ${sub.currentPeriodEnd.toDateString()}.` };
      }
      return { level: "readonly", reason: "Your subscription has ended. Your data is safe - resubscribe to continue.", warning: null };
    }
  }
}

/** Plan whose limits currently apply. */
export function effectivePlan(sub: SubscriptionLike | null): Plan {
  return sub?.plan ?? "STARTER";
}
