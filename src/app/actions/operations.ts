"use server";

import { revalidatePath } from "next/cache";
import { runAction, str } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { getTenant } from "@/lib/auth/current";
import { setCustomerPrice } from "@/server/pricing";
import { captureLine } from "@/server/preparation";
import { recordShortfall, recordNotDelivered } from "@/server/adjustments";
import { reconcileDay } from "@/server/payments";

// Every action resolves the tenant from the session + membership; no action
// accepts a businessId from the client.

export async function setCustomerPriceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    const clientId = str(fd, "clientId");
    await setCustomerPrice(ctx, clientId, str(fd, "productId"), str(fd, "price") || null);
    revalidatePath(`/app/clients/${clientId}/pricing`);
  });
}

export async function captureLineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    // Parallel arrays from repeated inputs: gross[] and tare[].
    const gross = fd.getAll("gross").map((v) => String(v));
    const tare = fd.getAll("tare").map((v) => String(v));
    const captures = gross.map((g, i) => ({ gross: g, tare: tare[i] ?? "" })).filter((c) => c.gross.trim() !== "");
    await captureLine(ctx, str(fd, "orderItemId"), { captures });
    revalidatePath(`/app/orders/${str(fd, "orderId")}`);
  });
}

export async function shortfallAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    await recordShortfall(ctx, str(fd, "orderItemId"), str(fd, "received"), str(fd, "reason"));
    revalidatePath(`/app/orders/${str(fd, "orderId")}`);
  });
}

export async function notDeliveredAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    await recordNotDelivered(ctx, str(fd, "orderItemId"), str(fd, "reason"));
    revalidatePath(`/app/orders/${str(fd, "orderId")}`);
  });
}

export async function reconcileDayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    await reconcileDay(ctx, str(fd, "date"));
    revalidatePath("/app/reconciliation");
  });
}
