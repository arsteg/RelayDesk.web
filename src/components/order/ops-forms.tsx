"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button, Input } from "@/components/ui";
import { captureLineAction, notDeliveredAction, shortfallAction } from "@/app/actions/operations";

/** Record crate/measure captures (gross + tare) for a variable-measure line. */
export function CaptureForm({ orderId, orderItemId }: { orderId: string; orderItemId: string }) {
  const [rows, setRows] = useState([{ gross: "", tare: "" }]);
  return (
    <ActionForm action={captureLineAction} className="space-y-2">
      {() => (
        <>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="orderItemId" value={orderItemId} />
          {rows.map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input name="gross" inputMode="decimal" placeholder="Gross" className="w-24" aria-label="Gross" />
              <span className="text-stone-400">−</span>
              <Input name="tare" inputMode="decimal" placeholder="Tare" className="w-24" aria-label="Tare" />
              {rows.length > 1 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove">×</Button>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows([...rows, { gross: "", tare: "" }])}>+ crate</Button>
            <SubmitButton size="sm">Save weights</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Reduce a line to the quantity actually received (shortfall). */
export function ShortfallForm({ orderId, orderItemId }: { orderId: string; orderItemId: string }) {
  return (
    <ActionForm action={shortfallAction} className="flex flex-wrap items-end gap-2">
      {() => (
        <>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="orderItemId" value={orderItemId} />
          <Input name="received" inputMode="decimal" placeholder="Received qty" className="w-28" aria-label="Received quantity" required />
          <Input name="reason" placeholder="Reason" className="w-40" aria-label="Reason" required minLength={3} />
          <SubmitButton size="sm" variant="secondary">Reduce</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

/** Remove a line that was not delivered. */
export function NotDeliveredForm({ orderId, orderItemId }: { orderId: string; orderItemId: string }) {
  return (
    <ActionForm action={notDeliveredAction} className="flex flex-wrap items-end gap-2">
      {() => (
        <>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="orderItemId" value={orderItemId} />
          <Input name="reason" placeholder="Reason" className="w-40" aria-label="Reason" required minLength={3} />
          <SubmitButton size="sm" variant="danger">Not delivered</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
