import { ActionButton } from "@/components/forms";
import { InviteForm, RoleSelect } from "@/components/settings/forms";
import { Badge, Card, PageHeader, TableWrap, Td, Th } from "@/components/ui";
import { requireTenantPage } from "@/lib/auth/current";
import { billingEnabled, signupEnabled } from "@/lib/features";
import { can, canManageRole, ROLE_LABELS } from "@/lib/permissions";
import { getPlan } from "@/lib/plans";
import { formatDate } from "@/lib/time";
import { listMembers } from "@/server/members";
import { removeMemberAction, revokeInviteAction, transferOwnershipAction } from "@/app/actions/admin";
import type { Role } from "@/generated/prisma/enums";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireTenantPage("members.view");
  const { members, invitations } = await listMembers(ctx);
  const manage = can(ctx.role, "members.manage") && ctx.access.level === "full";
  const plan = await getPlan(ctx.plan);
  const used = members.length + invitations.length;
  const seats = billingEnabled()
    ? `${used} of ${plan.maxMembers ?? "unlimited"} seats used on the ${plan.name} plan (pending invitations count).`
    : `${members.length} member${members.length === 1 ? "" : "s"}${invitations.length ? `, ${invitations.length} pending invitation${invitations.length === 1 ? "" : "s"}` : ""}.`;
  const roleOptions: Role[] = (["ADMIN", "STAFF"] as Role[]).filter((r) => canManageRole(ctx.role, r));

  return (
    <>
      <PageHeader title="Team" description={seats} />
      <div className="grid gap-6">
        {manage && (
          <Card title="Invite someone">
            <InviteForm canInviteAdmin={canManageRole(ctx.role, "ADMIN")} />
            <p className="mt-2 text-xs text-stone-500">Admins manage staff, products and exports. Staff handle clients, orders and payments. Only the owner manages settings and billing.</p>
            {!signupEnabled() && <p className="mt-1 text-xs text-stone-500">New sign-ups are turned off, so only people who already have a RelayDesk account can accept an invitation.</p>}
          </Card>
        )}
        <TableWrap>
          <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Joined</Th>{manage && <Th />}</tr></thead>
          <tbody className="divide-y divide-stone-100">
            {members.map((m) => {
              const editable = manage && m.userId !== ctx.userId && canManageRole(ctx.role, m.role);
              return (
                <tr key={m.id}>
                  <Td>{m.user.name}{m.userId === ctx.userId && <span className="ml-1 text-xs text-stone-400">(you)</span>}</Td>
                  <Td>{m.user.email}</Td>
                  <Td>{editable && roleOptions.length > 1 ? <RoleSelect membershipId={m.id} role={m.role} options={roleOptions} /> : <Badge tone={m.role === "OWNER" ? "violet" : m.role === "ADMIN" ? "blue" : "gray"}>{ROLE_LABELS[m.role]}</Badge>}</Td>
                  <Td>{formatDate(m.createdAt, ctx.business.timezone)}</Td>
                  {manage && (
                    <Td className="text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {ctx.role === "OWNER" && m.userId !== ctx.userId && m.user.emailVerifiedAt && (
                          <ActionButton action={transferOwnershipAction} fields={{ id: m.id }} confirm={`Make ${m.user.name} the owner? You'll become an admin.`}>Make owner</ActionButton>
                        )}
                        {editable && <ActionButton action={removeMemberAction} fields={{ id: m.id }} confirm="Remove from workspace?">Remove</ActionButton>}
                      </span>
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        {invitations.length > 0 && (
          <Card title="Pending invitations">
            <ul className="divide-y divide-stone-100">
              {invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>{i.email} · {ROLE_LABELS[i.role]} <span className="text-xs text-stone-500">expires {formatDate(i.expiresAt, ctx.business.timezone)}</span></span>
                  {manage && canManageRole(ctx.role, i.role) && <ActionButton action={revokeInviteAction} fields={{ id: i.id }}>Revoke</ActionButton>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
