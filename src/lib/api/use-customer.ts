"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession, type CustomerSession } from "@/lib/api/customer-session";

/**
 * Returns the customer session, redirecting to the login screen if absent.
 * localStorage is read after mount (not during render) to avoid an SSR/client
 * hydration mismatch, so the initial setState in the effect is intentional.
 */
export function useRequireCustomer(): CustomerSession | null {
  const router = useRouter();
  const [session, setSession] = useState<CustomerSession | null>(null);
  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/order/login");
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(s);
  }, [router]);
  return session;
}
