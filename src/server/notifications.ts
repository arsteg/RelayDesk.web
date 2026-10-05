import { prisma } from "@/lib/db";
import { appUrl, trySendEmail } from "@/lib/email";
import { changeEmailsEnabled } from "@/lib/features";
import { ORDER_STATUS, PAYMENT_KIND, PAYMENT_METHOD } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/time";
import type { TenantContext } from "@/server/context";
import { formatOrderNumber } from "@/server/orders";

/**
 * Change emails: every verified member of the business is told when a client,
 * order or payment is created, changed, archived/cancelled or voided.
 * Called after the change has committed (via `after()` in the server actions),
 * so they never slow down or fail the user's request. Each function re-reads
 * the record within the tenant and never throws.
 */

export type ClientChange = "created" | "updated" | "archived" | "restored";
export type OrderChange = "created" | "updated" | "status_changed" | "cancelled";
export type PaymentChange = "recorded" | "voided";

const CLIENT_VERB: Record<ClientChange, string> = { created: "added", updated: "updated", archived: "archived (deleted)", restored: "restored" };

interface Notice {
  subject: string;
  headline: string;
  details: (string | null | undefined | false)[];
  path: string;
}

async function send(ctx: TenantContext, notice: Notice) {
  if (!changeEmailsEnabled()) return;
  const [actor, members] = await Promise.all([
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }),
    prisma.membership.findMany({
      where: { businessId: ctx.businessId, user: { emailVerifiedAt: { not: null } } },
      select: { user: { select: { email: true } } },
    }),
  ]);
  const by = actor?.name ? `${actor.name} (${ctx.userEmail})` : ctx.userEmail;
  const text = [
    `${notice.headline} by ${by}.`,
    "",
    ...notice.details.filter((d): d is string => typeof d === "string"),
    "",
    `Open in RelayDesk: ${appUrl(notice.path)}`,
    "",
    `You get these emails because you are a member of ${ctx.business.name}.`,
  ].join("\n");
  await Promise.all(members.map((m) => trySendEmail({ to: m.user.email, subject: `[${ctx.business.name}] ${notice.subject}`, text })));
}

async function safely(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[notify] ${label} failed`, err);
  }
}

export function notifyClientChange(ctx: TenantContext, change: ClientChange, clientId: string) {
  return safely(`client.${change}`, async () => {
    const c = await prisma.client.findFirst({ where: { id: clientId, businessId: ctx.businessId } });
    if (!c) return;
    await send(ctx, {
      subject: `Client ${CLIENT_VERB[change]}: ${c.name}`,
      headline: `Client "${c.name}" was ${CLIENT_VERB[change]}`,
      details: [`Name: ${c.name}`, c.phone && `Phone: ${c.phone}`, c.email && `Email: ${c.email}`, c.address && `Address: ${c.address}`],
      path: `/app/clients/${c.id}`,
    });
  });
}

export function notifyOrderChange(ctx: TenantContext, change: OrderChange, orderId: string, extra: { reason?: string } = {}) {
  return safely(`order.${change}`, async () => {
    const o = await prisma.order.findFirst({
      where: { id: orderId, businessId: ctx.businessId },
      include: { client: { select: { name: true } }, items: { orderBy: { position: "asc" }, take: 10 } },
    });
    if (!o) return;
    const cur = ctx.business.currency;
    const number = formatOrderNumber(ctx.business.invoicePrefix, o.number);
    const what =
      change === "created" ? "added" : change === "updated" ? "edited" : change === "cancelled" ? "cancelled (deleted)" : `moved to ${ORDER_STATUS[o.status].label}`;
    await send(ctx, {
      subject: `Order ${number} ${what} - ${o.client.name}, ${formatMoney(o.totalMinor, cur)}`,
      headline: `Order ${number} for ${o.client.name} was ${what}`,
      details: [
        `Order: ${number}`,
        `Client: ${o.client.name}`,
        `Status: ${ORDER_STATUS[o.status].label}`,
        extra.reason && `Reason: ${extra.reason}`,
        `${o.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup"}: ${formatDateTime(o.fulfillmentAt, ctx.business.timezone)}`,
        `Total: ${formatMoney(o.totalMinor, cur)} · Paid: ${formatMoney(o.paidMinor, cur)}`,
        "",
        "Items:",
        ...o.items.map((i) => `  • ${i.description} - ${formatMoney(i.lineTotalMinor, cur)}`),
      ],
      path: `/app/orders/${o.id}`,
    });
  });
}

export function notifyPaymentChange(ctx: TenantContext, change: PaymentChange, paymentId: string) {
  return safely(`payment.${change}`, async () => {
    const p = await prisma.payment.findFirst({
      where: { id: paymentId, businessId: ctx.businessId },
      include: { order: { select: { id: true, number: true, totalMinor: true, paidMinor: true, client: { select: { name: true } } } } },
    });
    if (!p) return;
    const cur = ctx.business.currency;
    const number = formatOrderNumber(ctx.business.invoicePrefix, p.order.number);
    const kind = PAYMENT_KIND[p.kind];
    const what = change === "recorded" ? "recorded" : "voided (deleted)";
    await send(ctx, {
      subject: `${kind} ${what}: ${formatMoney(p.amountMinor, cur)} - ${p.order.client.name} (${number})`,
      headline: `A ${kind.toLowerCase()} of ${formatMoney(p.amountMinor, cur)} on order ${number} was ${what}`,
      details: [
        `Client: ${p.order.client.name}`,
        `Amount: ${formatMoney(p.amountMinor, cur)} (${kind}, ${PAYMENT_METHOD[p.method]})`,
        `Paid on: ${formatDate(p.paidOn)}`,
        p.reference && `Reference: ${p.reference}`,
        p.voidReason && `Void reason: ${p.voidReason}`,
        `Order total: ${formatMoney(p.order.totalMinor, cur)} · Paid so far: ${formatMoney(p.order.paidMinor, cur)}`,
      ],
      path: `/app/orders/${p.order.id}`,
    });
  });
}
