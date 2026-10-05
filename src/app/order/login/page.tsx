"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { ApiError, apiFetch } from "@/lib/api/client";
import { getSession, lastBusinessId, rememberBusinessId, saveSession } from "@/lib/api/customer-session";
import type { CustomerAuthResponse } from "@relaydesk/shared";

export default function CustomerLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getSession()) router.replace("/order/menu");
    // Prefill the remembered store id after mount (client-only localStorage).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusinessId(lastBusinessId() ?? "");
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await apiFetch<CustomerAuthResponse>("/customer/auth/login", {
        body: { email, password, businessId },
      });
      saveSession(data);
      rememberBusinessId(data.business.id);
      router.push("/order/menu");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Sign in" description="Place an order and track it live." />
      <Card>
        {error && (
          <Alert tone="red" className="mb-4">
            {error}
          </Alert>
        )}
        {!businessId && (
          <Alert tone="blue" className="mb-4">
            Use the invitation link you were sent to get started. If you already have an account, enter your
            store id below.
          </Alert>
        )}
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Field label="Store id" htmlFor="businessId" hint="Shown on your invitation; remembered after your first sign in.">
            <Input id="businessId" value={businessId} onChange={(e) => setBusinessId(e.target.value)} required />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
