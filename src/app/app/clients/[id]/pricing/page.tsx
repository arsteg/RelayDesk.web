import { ActionForm, SubmitButton } from "@/components/forms";
import { ButtonLink, Input, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { setCustomerPriceAction } from "@/app/actions/operations";
import { requireTenantPage } from "@/lib/auth/current";
import { listCustomerPrices } from "@/server/pricing";
import { formatMoney, minorToInput } from "@/lib/money";

export const metadata = { title: "Customer pricing" };

export default async function CustomerPricingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantPage("pricing.manage");
  const { client, rows } = await listCustomerPrices(ctx, id);
  const cur = ctx.business.currency;

  return (
    <>
      <PageHeader
        title={`Pricing — ${client.name}`}
        description="Negotiated price per product for this customer, in the product's unit. Leave blank to use the default price."
        back={{ href: `/app/clients/${id}`, label: "Back to client" }}
      />
      <TableWrap>
        <thead>
          <tr>
            <Th>Product</Th>
            <Th>Unit</Th>
            <Th className="text-right">Default</Th>
            <Th className="text-right">Customer price</Th>
            <Th />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((r) => (
            <tr key={r.productId}>
              <Td className="font-medium">{r.name}</Td>
              <Td className="text-stone-500">{r.unit}</Td>
              <Td className="text-right tabular-nums text-stone-500">{formatMoney(r.defaultPriceMinor, cur)}</Td>
              <Td>
                <ActionForm action={setCustomerPriceAction} className="flex items-center justify-end gap-2">
                  {() => (
                    <>
                      <input type="hidden" name="clientId" value={id} />
                      <input type="hidden" name="productId" value={r.productId} />
                      <Input
                        name="price"
                        inputMode="decimal"
                        className="w-28 text-right"
                        placeholder={minorToInput(r.defaultPriceMinor, cur)}
                        defaultValue={r.customPriceMinor !== null ? minorToInput(r.customPriceMinor, cur) : ""}
                        aria-label={`Price for ${r.name}`}
                      />
                      <SubmitButton variant="secondary" size="sm">Save</SubmitButton>
                    </>
                  )}
                </ActionForm>
              </Td>
              <Td className="text-xs text-stone-400">{r.customPriceMinor !== null ? "custom" : ""}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <div className="mt-4">
        <ButtonLink href={`/app/clients/${id}`} variant="ghost">Done</ButtonLink>
      </div>
    </>
  );
}
