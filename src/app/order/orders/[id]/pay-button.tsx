"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

/** Fields the FastAPI /pay endpoint returns to open Razorpay Checkout. */
interface StartPaymentResponse {
  razorpayOrderId: string;
  keyId: string;
  amountMinor: number;
  currency: string;
  orderNumber: number;
  name: string;
}

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
}
interface RazorpayCtor {
  new (options: Record<string, unknown>): RazorpayInstance;
}
declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckout(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.Razorpay) return resolve();
    const existing = document.querySelector(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("load failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = CHECKOUT_SRC;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("load failed"));
    document.body.appendChild(s);
  });
}

/**
 * "Pay now" for the signed-in customer. Creates a Razorpay order on the backend
 * (which settles to the supplier's own account), opens Razorpay Checkout, then
 * verifies the handshake server-side so the payment is recorded against the order.
 */
export function PayButton({ orderId, token, onPaid }: { orderId: string; token: string; onPaid: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const start = await apiFetch<StartPaymentResponse>(`/customer/orders/${orderId}/pay`, { method: "POST", token });
      await loadCheckout();
      if (!window.Razorpay) throw new Error("Razorpay unavailable");
      const rzp = new window.Razorpay({
        key: start.keyId,
        order_id: start.razorpayOrderId,
        amount: start.amountMinor,
        currency: start.currency,
        name: start.name,
        description: `Order #${start.orderNumber}`,
        handler: async (resp: RazorpayHandlerResponse) => {
          try {
            await apiFetch(`/customer/orders/${orderId}/pay/verify`, {
              method: "POST",
              token,
              body: {
                razorpayOrderId: resp.razorpay_order_id,
                razorpayPaymentId: resp.razorpay_payment_id,
                razorpaySignature: resp.razorpay_signature,
              },
            });
            onPaid();
          } catch {
            setError("Payment captured but confirmation failed. It will reconcile shortly.");
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payment.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button onClick={pay} disabled={busy}>
        {busy ? "Starting…" : "Pay now"}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
