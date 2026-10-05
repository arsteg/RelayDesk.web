"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Td, Th, TableWrap } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api/client";
import type { InvitationPublic } from "@relaydesk/shared";

interface CustomerRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  clientId: string;
}
interface CustomersResponse {
  pending: InvitationPublic[];
  customers: CustomerRow[];
}

export default function CustomersPage() {
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<CustomersResponse>("/admin/customers"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load customers.");
    }
  }, []);

  useEffect(() => {
    // Load once on mount; setState happens after the async fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErr({});
    setInviteLink(null);
    setBusy(true);
    try {
      const res = await apiFetch<{ inviteUrl: string }>("/admin/customers/invite", {
        body: { email, name: name || null, phone: phone || null },
      });
      setInviteLink(res.inviteUrl);
      setEmail("");
      setName("");
      setPhone("");
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.fields) setFieldErr(err.fields);
      } else setError("Could not send the invitation.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await apiFetch(`/admin/customers/invitations/${id}/revoke`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke the invitation.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="Invite customers to order online and manage their access." />
      {error && <Alert tone="red">{error}</Alert>}

      <Card title="Invite a customer">
        <form onSubmit={invite} className="grid gap-4 sm:grid-cols-3">
          <Field label="Email" htmlFor="email" error={fieldErr.email} className="sm:col-span-1">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required invalid={!!fieldErr.email} />
          </Field>
          <Field label="Name (optional)" htmlFor="name">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Phone (optional)" htmlFor="phone">
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send invitation"}
            </Button>
          </div>
        </form>
        {inviteLink && (
          <Alert tone="green" className="mt-4" title="Invitation created">
            Share this link with the customer:
            <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs ring-1 ring-emerald-200">{inviteLink}</code>
          </Alert>
        )}
      </Card>

      <Card title="Pending invitations">
        {!data ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : data.pending.length === 0 ? (
          <EmptyState title="No pending invitations" />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Name</Th>
                <Th>Expires</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.pending.map((inv) => (
                <tr key={inv.id}>
                  <Td>{inv.email}</Td>
                  <Td>{inv.name ?? "—"}</Td>
                  <Td>{new Date(inv.expiresAt).toLocaleDateString()}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="secondary" onClick={() => revoke(inv.id)}>
                      Revoke
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card title="Customers">
        {!data ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : data.customers.length === 0 ? (
          <EmptyState title="No customers yet" description="Invited customers who complete onboarding appear here." />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.customers.map((c) => (
                <tr key={c.id}>
                  <Td>{c.name}</Td>
                  <Td>{c.email}</Td>
                  <Td>{c.phone ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
