import { Card } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";

export const metadata = { title: "Data export" };

const EXPORTS = [
  { kind: "clients", label: "Clients", desc: "All clients including archived, with outstanding balances." },
  { kind: "orders", label: "Orders", desc: "Every order with items, totals, paid amount and balance." },
  { kind: "payments", label: "Payments", desc: "Deposits, payments and refunds including voided entries." },
];

export default async function ExportPage() {
  await requireTenantPage("data.export");
  return (
    <div className="grid max-w-3xl gap-4">
      <p className="text-sm text-stone-600">CSV files open in Excel, Google Sheets or Numbers. Exports are always available, even if your subscription lapses.</p>
      {EXPORTS.map((e) => (
        <Card key={e.kind}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{e.label}</p>
              <p className="text-sm text-stone-500">{e.desc}</p>
            </div>
            <a href={`/api/export/${e.kind}`} className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium ring-1 ring-stone-300 hover:bg-stone-50">Download CSV</a>
          </div>
        </Card>
      ))}
    </div>
  );
}
