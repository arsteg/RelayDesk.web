"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { runAction, str } from "@/lib/action";
import type { ActionState } from "@/lib/action-state";
import { getTenant } from "@/lib/auth/current";
import { ValidationError } from "@/lib/errors";
import type { OrderStatus } from "@/generated/prisma/enums";
import { createClient, setClientArchived, updateClient } from "@/server/clients";
import { createCategory, setCategoryArchived, updateCategory } from "@/server/categories";
import { createProduct, setProductArchived, updateProduct } from "@/server/products";
import { changeOrderStatus, createOrder, getOrder, updateOrder, type OrderInput } from "@/server/orders";
import { recordPayment, voidPayment } from "@/server/payments";
import { notifyClientChange, notifyOrderChange, notifyPaymentChange } from "@/server/notifications";

// Every action resolves the tenant from the session + membership.
// No action accepts a businessId from the client.
// Change emails are scheduled with after() once the service call has
// committed, so email never delays or fails the request.

function clientInput(fd: FormData) {
  return { name: str(fd, "name"), phone: str(fd, "phone"), email: str(fd, "email"), address: str(fd, "address"), notes: str(fd, "notes") };
}

export async function createClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    const client = await createClient(ctx, clientInput(fd));
    after(() => notifyClientChange(ctx, "created", client.id));
    const next = str(fd, "next");
    redirect(next === "order" ? `/app/orders/new?clientId=${client.id}` : `/app/clients/${client.id}`);
  });
}

export async function updateClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    const id = str(fd, "id");
    await updateClient(ctx, id, clientInput(fd));
    after(() => notifyClientChange(ctx, "updated", id));
    redirect(`/app/clients/${id}`);
  });
}

export async function archiveClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    const id = str(fd, "id");
    const archived = str(fd, "archived") === "1";
    await setClientArchived(ctx, id, archived);
    after(() => notifyClientChange(ctx, archived ? "archived" : "restored", id));
    revalidatePath(`/app/clients/${id}`);
  });
}

function productInput(fd: FormData) {
  const orderUnitsRaw = str(fd, "orderUnits");
  return {
    name: str(fd, "name"),
    categoryId: str(fd, "categoryId") || null,
    description: str(fd, "description"),
    unit: str(fd, "unit"),
    price: str(fd, "price"),
    isAvailable: fd.get("isAvailable") === "on",
    isVariableMeasure: fd.get("isVariableMeasure") === "on",
    orderUnits: orderUnitsRaw ? orderUnitsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    estConversion: str(fd, "estConversion") || null,
  };
}

export async function createProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    await createProduct(ctx, productInput(fd));
    redirect("/app/products");
  });
}

export async function updateProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    await updateProduct(ctx, str(fd, "id"), productInput(fd));
    redirect("/app/products");
  });
}

export async function archiveProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    await setProductArchived(ctx, str(fd, "id"), str(fd, "archived") === "1");
    revalidatePath("/app/products");
  });
}

export async function createCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    await createCategory(ctx, { name: str(fd, "name") });
    revalidatePath("/app/products/categories");
    return { ok: true, message: "Category created." };
  });
}

export async function updateCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    await updateCategory(ctx, str(fd, "id"), { name: str(fd, "name") });
    redirect("/app/products/categories");
  });
}

export async function archiveCategoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    await setCategoryArchived(ctx, str(fd, "id"), str(fd, "archived") === "1");
    revalidatePath("/app/products/categories");
  });
}

function orderPayload(fd: FormData): OrderInput {
  try {
    return JSON.parse(str(fd, "payload")) as OrderInput;
  } catch {
    throw new ValidationError("The order form could not be read. Please reload and try again.");
  }
}

export async function createOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(null, async () => {
    const ctx = await getTenant();
    const order = await createOrder(ctx, orderPayload(fd));
    after(() => notifyOrderChange(ctx, "created", order.id));
    redirect(`/app/orders/${order.id}?created=1`);
  });
}

export async function updateOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(null, async () => {
    const ctx = await getTenant();
    const id = str(fd, "id");
    await updateOrder(ctx, id, orderPayload(fd));
    after(() => notifyOrderChange(ctx, "updated", id));
    redirect(`/app/orders/${id}`);
  });
}

export async function changeOrderStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    const id = str(fd, "id");
    const status = str(fd, "status") as OrderStatus;
    const reason = str(fd, "reason") || undefined;
    const { status: from } = await getOrder(ctx, id);
    await changeOrderStatus(ctx, id, status, reason);
    if (from !== status) after(() => notifyOrderChange(ctx, status === "CANCELLED" ? "cancelled" : "status_changed", id, { reason }));
    revalidatePath(`/app/orders/${id}`);
  });
}

export async function recordPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    const orderId = str(fd, "orderId");
    const { payment } = await recordPayment(ctx, orderId, {
      kind: str(fd, "kind") as "PAYMENT",
      amount: str(fd, "amount"),
      paidOn: str(fd, "paidOn"),
      method: str(fd, "method") as "CASH",
      reference: str(fd, "reference"),
      notes: str(fd, "notes"),
    });
    after(() => notifyPaymentChange(ctx, "recorded", payment.id));
    const back = str(fd, "back");
    redirect(back === "payments" ? "/app/payments?recorded=1" : `/app/orders/${orderId}?paid=1`);
  });
}

export async function voidPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const ctx = await getTenant();
    const paymentId = str(fd, "paymentId");
    const order = await voidPayment(ctx, paymentId, str(fd, "reason"));
    after(() => notifyPaymentChange(ctx, "voided", paymentId));
    revalidatePath(`/app/orders/${order.id}`);
    return { ok: true, message: "Payment voided." };
  });
}
