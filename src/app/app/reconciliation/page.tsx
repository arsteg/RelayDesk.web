import { ActionButton } from "@/components/forms";
import { Badge, Button, Card, Input, PageHeader, Stat, TableWrap, Td, Th } from "@/components/ui";
import { reconcileDayAction } from "@/app/actions/operations";
import { requireTenantPage } from "@/lib/auth/current";
import { getReconciliation } from "@/server/payments";
import { formatMoney } from "@/lib/money";
import { zonedDateString } from "@/lib/time";
import { sp, type SearchParams } from "@/lib/page";

export const metadata = { title: "Reconciliation" };

export default async function ReconciliationPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenantPage("payments.record");
  const params = await searchParams;
  const date = sp(params, "date") || zonedDateString(new Date(), ctx.business.timezone);
  const r = await getReconciliation(ctx, date);
  const cur = ctx.business.currency;
  const diff = r.differenceMinor;

  return (
    <>
      <PageHeader title="Payment reconciliation" description="Expected (orders due) versus collected (payments taken) for a day." />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-stone-700">Date</span>
          <Input type="date" name="date" defaultValue={date} className="w-auto" />
        </label>
        <Button type="submit" variant="secondary">Show</Button>
      </form>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Expected" value={formatMoney(r.expectedMinor, cur)} />
        <Stat label="Collected" value={formatMoney(r.collectedMinor, cur)} />
        <Stat label="Difference" value={formatMoney(diff, cur)} tone={diff > 0 ? "red" : "green"} hint={diff > 0 ? "Short" : diff < 0 ? "Over" : "Balanced"} />
      </div>

      <Card title="Collected by method" actions={<Badge tone={r.unreconciled ? "amber" : "green"}>{r.unreconciled} unreconciled</Badge>}>
        {r.byMethod.length === 0 ? (
          <p className="text-sm text-stone-500">No payments recorded on this date.</p>
        ) : (
          <TableWrap>
            <thead><tr><Th>Method</Th><Th className="text-right">Amount</Th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {r.byMethod.map((m) => (
                <tr key={m.method}>
                  <Td>{m.method.replace("_", " ")}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(m.amountMinor, cur)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        {r.unreconciled > 0 && (
          <div className="mt-4">
            <ActionButton action={reconcileDayAction} fields={{ date }} confirm={`Mark ${r.unreconciled} payment(s) reconciled?`}>
              Reconcile {date}
            </ActionButton>
          </div>
        )}
      </Card>
    </>
  );
}
