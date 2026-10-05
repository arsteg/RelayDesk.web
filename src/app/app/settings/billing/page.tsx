import { notFound } from "next/navigation";
import { CheckoutButton, PortalButton, SimulateButton } from "@/components/settings/forms";
import { Alert, Badge, Card, DescriptionList } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { SUBSCRIPTION_STATUS } from "@/lib/labels";
import { billingEnabled } from "@/lib/features";
import { getPlans, PAST_DUE_GRACE_DAYS } from "@/lib/plans";
import { sp, type SearchParams } from "@/lib/page";
import { formatDate } from "@/lib/time";
import { getBillingOverview } from "@/server/billing";

export const metadata = { title: "Billing" };

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums">{used} / {limit ?? "∞"}</span></div>
      {limit && <div className="mt-1 h-2 rounded-full bg-stone-100"><div className={`h-2 rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-brand-500"}`} style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  if (!billingEnabled()) notFound();
  const ctx = await requireTenantPage("billing.manage");
  const q = await searchParams;
  const o = await getBillingOverview(ctx);
  const sub = o.subscription;
  const plans = Object.values(await getPlans());
  const hasStripeSub = !!sub?.stripeSubscriptionId && sub.status !== "CANCELED";

  return (
    <div className="grid max-w-4xl gap-6">
      {sp(q, "checkout") === "success" && <Alert tone="green">Thanks! Your subscription will update as soon as Stripe confirms the payment (usually a few seconds).</Alert>}
      {sp(q, "checkout") === "cancelled" && <Alert tone="amber">Checkout was cancelled. No changes were made.</Alert>}
      <p className="text-sm text-stone-600">This is your RelayDesk subscription. It is completely separate from the payments your customers make to you.</p>

      <Card title="Current plan" actions={sub && <Badge tone={SUBSCRIPTION_STATUS[sub.status].tone}>{SUBSCRIPTION_STATUS[sub.status].label}</Badge>}>
        <div className="grid gap-6 md:grid-cols-2">
          <DescriptionList
            items={[
              { label: "Plan", value: o.plan.name },
              { label: "Access", value: o.access.level === "full" ? "Full access" : "Read-only" },
              ...(sub?.status === "TRIALING" && sub.trialEndsAt ? [{ label: "Trial ends", value: formatDate(sub.trialEndsAt) }] : []),
              ...(sub?.currentPeriodEnd ? [{ label: sub.status === "CANCELED" || sub.cancelAtPeriodEnd ? "Access until" : "Renews", value: formatDate(sub.currentPeriodEnd) }] : []),
              ...(sub?.pastDueSince ? [{ label: "Payment failed on", value: formatDate(sub.pastDueSince) }] : []),
            ]}
          />
          <div className="space-y-4">
            <Usage label="Team members (incl. pending invites)" used={o.seats.used} limit={o.plan.maxMembers} />
            <Usage label="Orders this month" used={o.orders.used} limit={o.orders.limit} />
          </div>
        </div>
        {(o.access.reason || o.access.warning) && <Alert tone={o.access.level === "full" ? "amber" : "red"} className="mt-4">{o.access.reason ?? o.access.warning}</Alert>}
        {o.mode === "stripe" && hasStripeSub && <div className="mt-4"><PortalButton /></div>}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((p) => (
          <Card key={p.id} title={<span className="flex items-center gap-2">{p.name} {sub?.plan === p.id && sub.status !== "CANCELED" && <Badge tone="green">Current</Badge>}</span>}>
            <p className="text-sm text-stone-500">{p.description}</p>
            <p className="mt-3 text-xl font-semibold">{p.priceLabel}</p>
            <ul className="mt-3 space-y-1 text-sm text-stone-600">
              <li>• {p.maxMembers ?? "Unlimited"} team members</li>
              <li>• {p.maxMonthlyOrders ?? "Unlimited"} orders / month</li>
            </ul>
            {o.mode === "stripe" && !hasStripeSub && <div className="mt-4"><CheckoutButton plan={p.id} label={`Subscribe to ${p.name}`} /></div>}
            {o.mode === "stripe" && hasStripeSub && sub?.plan !== p.id && <p className="mt-4 text-xs text-stone-500">Switch plans from “Manage billing”.</p>}
          </Card>
        ))}
      </div>

      {o.mode === "simulation" && (
        <Card title="Development billing simulator">
          <p className="mb-3 text-sm text-stone-600">
            Stripe keys are not configured, so billing is simulated. These buttons change the subscription state directly (development only) so you can try plan limits, the {PAST_DUE_GRACE_DAYS()}-day past-due grace period and read-only mode.
          </p>
          <div className="flex flex-wrap gap-2">
            <SimulateButton action="activate_starter" label="Activate Starter" />
            <SimulateButton action="activate_pro" label="Activate Pro" />
            <SimulateButton action="past_due" label="Payment failed (in grace)" />
            <SimulateButton action="past_due_expired" label="Past due beyond grace" />
            <SimulateButton action="cancel" label="Cancel subscription" />
            <SimulateButton action="expire_trial" label="Expire trial" />
            <SimulateButton action="restart_trial" label="Restart trial" />
          </div>
        </Card>
      )}
      {o.mode === "unconfigured" && <Alert tone="red">Stripe is not configured on this server. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the plan price IDs.</Alert>}
    </div>
  );
}
