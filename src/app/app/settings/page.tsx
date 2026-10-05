import { LogoForm, SettingsForm } from "@/components/settings/forms";
import { Alert, Card } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { formatBps } from "@/lib/money";
import { can } from "@/lib/permissions";
import { getSettings } from "@/server/settings";

export const metadata = { title: "Business settings" };

export default async function SettingsPage() {
  const ctx = await requireTenantPage();
  const b = await getSettings(ctx);
  const owner = can(ctx.role, "settings.manage");
  return (
    <div className="grid max-w-3xl gap-6">
      {!owner && <Alert tone="blue">Only the workspace owner can change these settings.</Alert>}
      {owner && (
        <Card title="Logo">
          <LogoForm hasLogo={!!b.logoMimeType} version={b.updatedAt.getTime()} />
        </Card>
      )}
      <Card title="Business details">
        <SettingsForm
          disabled={!owner}
          initial={{
            name: b.name, phone: b.phone ?? "", email: b.email ?? "", address: b.address ?? "", website: b.website ?? "",
            taxId: b.taxId ?? "", currency: b.currency, timezone: b.timezone, defaultTaxRate: formatBps(b.defaultTaxBps),
            invoiceFooter: b.invoiceFooter ?? "", invoicePrefix: b.invoicePrefix,
          }}
        />
      </Card>
    </div>
  );
}
