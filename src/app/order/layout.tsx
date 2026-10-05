"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { clearSession, getSession, type CustomerSession } from "@/lib/api/customer-session";
import { useCart } from "@/lib/api/cart";

export default function OrderLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<CustomerSession | null>(null);
  const [ready, setReady] = useState(false);
  const cart = useCart(session?.business.id);

  useEffect(() => {
    // Read localStorage only after mount to avoid an SSR/client hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(getSession());
    setReady(true);
  }, [pathname]);

  const cartCount = cart.reduce((n, l) => n + l.quantity, 0);
  const signedIn = Boolean(session);

  const logout = async () => {
    try {
      await apiFetch("/customer/auth/logout", { token: session?.token, method: "POST" });
    } catch {
      /* best effort */
    }
    clearSession();
    router.push("/order/login");
  };

  const navLink = (href: string, label: string, badge?: number) => (
    <Link
      href={href}
      className={cx(
        "rounded-lg px-3 py-1.5 text-sm font-medium",
        pathname === href ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100",
      )}
    >
      {label}
      {badge ? <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-xs text-white">{badge}</span> : null}
    </Link>
  );

  return (
    <div className="min-h-dvh bg-stone-50">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <Link href={signedIn ? "/order/menu" : "/order/login"} className="flex items-center gap-2 font-semibold">
            <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
              {(session?.business.name ?? "D").charAt(0)}
            </span>
            <span className="truncate">{session?.business.name ?? "RelayDesk"}</span>
          </Link>
          {ready && signedIn && (
            <nav className="flex items-center gap-1">
              {navLink("/order/menu", "Menu")}
              {navLink("/order/cart", "Cart", cartCount)}
              {navLink("/order/orders", "Orders")}
              <button onClick={logout} className="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100">
                Sign out
              </button>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
