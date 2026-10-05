"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { recordPaymentAction, voidPaymentAction } from "@/app/actions/business";

const METHODS = [["CASH", "Cash"], ["UPI", "UPI"], ["CARD", "Card"], ["BANK_TRANSFER", "Bank transfer"], ["CHEQUE", "Cheque"], ["OTHER", "Other"]] as const;

export function PaymentForm({
  orderId, today, balance, paid, cancelled, back, orders, canRefund = false,
}: {
  orderId?: string;
  today: string;
  /** Outstanding balance as a decimal string, for the default amount */
  balance?: string;
  paid?: boolean;
  cancelled?: boolean;
  back?: "payments";
  orders?: { id: string; label: string }[];
  canRefund?: boolean;
}) {
  const defaultKind = canRefund && (cancelled || paid) ? "REFUND" : "PAYMENT";
  return (
    <ActionForm action={recordPaymentAction} className="grid gap-3 sm:grid-cols-2">
      {(s) => {
        const e = s.fieldErrors ?? {};
        const val = (k: string, d = "") => s.values?.[k] ?? d;
        return (
          <>
            {back && <input type="hidden" name="back" value={back} />}
            {orderId ? (
              <input type="hidden" name="orderId" value={orderId} />
            ) : (
              <Field label="Order" htmlFor="orderId" className="sm:col-span-2">
                <Select id="orderId" name="orderId" defaultValue={val("orderId")} required>
                  <option value="">Select an order with a balance…</option>
                  {orders?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Type" htmlFor="kind">
              <Select id="kind" name="kind" defaultValue={val("kind", defaultKind)}>
                {!cancelled && <option value="DEPOSIT">Deposit</option>}
                {!cancelled && <option value="PAYMENT">Payment</option>}
                {canRefund && <option value="REFUND">Refund</option>}
              </Select>
            </Field>
            <Field label="Amount" htmlFor="amount" error={e.amount}>
              <Input id="amount" name="amount" inputMode="decimal" required defaultValue={val("amount", paid || cancelled ? "" : (balance ?? ""))} invalid={!!e.amount} />
            </Field>
            <Field label="Date" htmlFor="paidOn" error={e.paidOn}>
              <Input id="paidOn" name="paidOn" type="date" max={today} defaultValue={val("paidOn", today)} invalid={!!e.paidOn} />
            </Field>
            <Field label="Method" htmlFor="method">
              <Select id="method" name="method" defaultValue={val("method", "UPI")}>
                {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Reference" htmlFor="reference" error={e.reference} hint="UPI txn ID, cheque no…" className="sm:col-span-2">
              <Input id="reference" name="reference" defaultValue={val("reference")} />
            </Field>
            <Field label="Notes" htmlFor="notes" error={e.notes} className="sm:col-span-2">
              <Textarea id="notes" name="notes" rows={2} defaultValue={val("notes")} />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton pendingText="Recording…">Record</SubmitButton>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}

export function VoidPaymentForm({ paymentId }: { paymentId: string }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-stone-500 hover:text-red-700">Void</summary>
      <ActionForm action={voidPaymentAction} className="mt-2 flex flex-col gap-2">
        {(s) => (
          <>
            <input type="hidden" name="paymentId" value={paymentId} />
            <Input name="reason" placeholder="Reason (required)" aria-label="Reason for voiding" defaultValue={s.values?.reason} />
            <SubmitButton variant="danger" size="sm" pendingText="Voiding…">Void payment</SubmitButton>
          </>
        )}
      </ActionForm>
    </details>
  );
}
