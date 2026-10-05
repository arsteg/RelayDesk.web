"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api/client";
import { rememberBusinessId, saveSession } from "@/lib/api/customer-session";
import type { AcceptInvitationRequest, CustomerAuthResponse, InvitationPublic } from "@relaydesk/shared";

export default function AcceptInvitation({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [invite, setInvite] = useState<InvitationPublic | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<InvitationPublic>(`/invitations/${token}`)
      .then((inv) => {
        setInvite(inv);
        setName(inv.name ?? "");
      })
      .catch(() => setLoadError("This invitation is invalid or has expired. Ask the business that invited you for a new link."));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: AcceptInvitationRequest = { name, password, phone: phone || null };
      const data = await apiFetch<CustomerAuthResponse>(`/invitations/${token}/accept`, { body });
      saveSession(data);
      rememberBusinessId(data.business.id);
      router.push("/order/menu");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not complete onboarding.");
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-md">
        <PageHeader title="Invitation" />
        <Alert tone="red">{loadError}</Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title={invite ? `Join ${invite.businessName}` : "Loading…"}
        description={invite ? `Set up your account for ${invite.email}.` : undefined}
      />
      <Card>
        {error && (
          <Alert tone="red" className="mb-4">
            {error}
          </Alert>
        )}
        <form onSubmit={submit} className="space-y-4">
          <Field label="Your name" htmlFor="name">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </Field>
          <Field label="Phone (optional)" htmlFor="phone">
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
          </Field>
          <Field label="Choose a password" htmlFor="password" hint="At least 10 characters.">
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
          </Field>
          <Button type="submit" disabled={busy || !invite} className="w-full">
            {busy ? "Creating account…" : "Create account & start ordering"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
