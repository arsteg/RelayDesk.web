import { Button, EmptyState, Input, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { getPreparationSheet } from "@/server/preparation";
import { zonedDateString } from "@/lib/time";
import { sp, type SearchParams } from "@/lib/page";

export const metadata = { title: "Preparation" };

export default async function PreparationPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireTenantPage("prep.record");
  const params = await searchParams;
  const date = sp(params, "date") || zonedDateString(new Date(), ctx.business.timezone);
  const sheet = await getPreparationSheet(ctx, date);

  return (
    <>
      <PageHeader title="Preparation sheet" description="What to prepare for a fulfilment date, totalled across all confirmed orders." />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-stone-700">Fulfilment date</span>
          <Input type="date" name="date" defaultValue={date} className="w-auto" />
        </label>
        <Button type="submit" variant="secondary">Show</Button>
        <span className="ml-auto self-center text-sm text-stone-500">{sheet.orderCount} order{sheet.orderCount === 1 ? "" : "s"}</span>
      </form>

      {sheet.rows.length === 0 ? (
        <EmptyState title="Nothing to prepare" description="No confirmed orders for this date." />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Order unit</Th>
              <Th className="text-right">Total ordered</Th>
              <Th className="text-right">Est. measure</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sheet.rows.map((r, i) => (
              <tr key={i}>
                <Td className="font-medium">{r.name}</Td>
                <Td className="text-stone-500">{r.orderUnit}</Td>
                <Td className="text-right tabular-nums">{r.orderedQty}</Td>
                <Td className="text-right tabular-nums text-stone-500">{r.estMeasure ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
