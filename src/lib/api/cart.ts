"use client";

/**
 * A tiny localStorage-backed cart for the web ordering portal, scoped per
 * business. The cart only holds product ids + quantities; all pricing is computed
 * by the backend when the order is placed.
 */

import { useMemo, useSyncExternalStore } from "react";

export interface CartLine {
  productId: string;
  name: string;
  priceMinor: number;
  unit: string;
  quantity: number;
}

const KEY = (businessId: string) => `relaydesk.cart.${businessId}`;
const listeners = new Set<() => void>();

function read(businessId: string): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY(businessId)) || "[]") as CartLine[];
  } catch {
    return [];
  }
}

function write(businessId: string, lines: CartLine[]) {
  localStorage.setItem(KEY(businessId), JSON.stringify(lines));
  listeners.forEach((l) => l());
}

export function addToCart(businessId: string, item: Omit<CartLine, "quantity">, qty = 1) {
  const lines = read(businessId);
  const existing = lines.find((l) => l.productId === item.productId);
  if (existing) existing.quantity += qty;
  else lines.push({ ...item, quantity: qty });
  write(businessId, lines);
}

export function setQuantity(businessId: string, productId: string, qty: number) {
  let lines = read(businessId);
  if (qty <= 0) lines = lines.filter((l) => l.productId !== productId);
  else lines = lines.map((l) => (l.productId === productId ? { ...l, quantity: qty } : l));
  write(businessId, lines);
}

export function clearCart(businessId: string) {
  write(businessId, []);
}

export function cartSubtotalMinor(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + Math.round(l.priceMinor * l.quantity), 0);
}

/** React hook that re-renders when the cart changes (also across tabs). */
export function useCart(businessId: string | undefined): CartLine[] {
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    const onStorage = () => cb();
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  };
  const snapshot = () => (businessId ? localStorage.getItem(KEY(businessId)) || "[]" : "[]");
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  return useMemo(() => {
    try {
      return JSON.parse(raw) as CartLine[];
    } catch {
      return [];
    }
  }, [raw]);
}
