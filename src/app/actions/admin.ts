"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, str } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { getTenant } from "@/lib/auth/current";
import { ValidationError } from "@/lib/errors";
import type { Plan, Role } from "@/generated/prisma/enums";
import { updateLogo, updateSettings } from "@/server/settings";
import { changeMemberRole, inviteMember, removeMember, revokeInvitation, transferOwnership } from "@/server/members";
import { createCheckoutSession, createPortalSession, simulateBilling, type SimulationAction } from "@/server/billing";

// ----- Business settings (owner) -----

export async function updateSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    await updateSettings(ctx, {
      name: str(fd, "name"),
      phone: str(fd, "phone"),
      email: str(fd, "email"),
      address: str(fd, "address"),
      website: str(fd, "website"),
      taxId: str(fd, "taxId"),
      currency: str(fd, "currency"),
      timezone: str(fd, "timezone"),
      defaultTaxRate: str(fd, "defaultTaxRate"),
      invoiceFooter: str(fd, "invoiceFooter"),
      invoicePrefix: str(fd, "invoicePrefix"),
    });
    revalidatePath("/app", "layout");
    return { ok: true, message: "Settings saved." };
  });
}

export async function uploadLogoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(null, async () => {
    const ctx = await getTenant();
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose an image to upload.");
    await updateLogo(ctx, new Uint8Array(await file.arrayBuffer()));
    revalidatePath("/app/settings");
    return { ok: true, message: "Logo updated." };
  });
}

export async function removeLogoAction(): Promise<ActionState> {
  return runAction(null, async () => {
    const ctx = await getTenant();
    await updateLogo(ctx, null);
    revalidatePath("/app/settings");
  });
}

// ----- Team (owner/admin) -----

export async function inviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    const email = str(fd, "email");
    const res = await inviteMember(ctx, { email, role: str(fd, "role") as "STAFF" });
    revalidatePath("/app/team");
    if (!res.emailSent) {
      return { ok: true, message: `Invitation created, but the email could not be delivered. Share this link with them directly (valid 7 days): ${res.inviteUrl}` };
    }
    return { ok: true, message: `Invitation sent to ${email.trim().toLowerCase()}.` };
  });
}

export async function revokeInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await revokeInvitation(await getTenant(), str(fd, "id"));
    revalidatePath("/app/team");
  });
}

export async function changeRoleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await changeMemberRole(await getTenant(), str(fd, "id"), str(fd, "role") as Role);
    revalidatePath("/app/team");
  });
}

export async function removeMemberAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await removeMember(await getTenant(), str(fd, "id"));
    revalidatePath("/app/team");
  });
}

export async function transferOwnershipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await transferOwnership(await getTenant(), str(fd, "id"));
    redirect("/app/team");
  });
}

// ----- Billing (owner) -----

export async function checkoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const url = await createCheckoutSession(await getTenant(), str(fd, "plan") as Plan);
    redirect(url);
  });
}

export async function portalAction(): Promise<ActionState> {
  return runAction(null, async () => {
    const url = await createPortalSession(await getTenant());
    redirect(url);
  });
}

export async function simulateBillingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await simulateBilling(await getTenant(), str(fd, "simulate") as SimulationAction);
    revalidatePath("/app", "layout");
  });
}
