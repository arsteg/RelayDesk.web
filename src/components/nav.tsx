"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "@/components/ui";

export interface NavItem {
  href: string;
  label: string;
}

export function SideNav({ items, footer }: { items: NavItem[]; footer?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
  const links = (
    <ul className="space-y-0.5">
      {items.map((i) => (
        <li key={i.href}>
          <Link
            href={i.href}
            onClick={() => setOpen(false)}
            className={cx(
              "block rounded-lg px-3 py-2 text-sm font-medium",
              isActive(i.href) ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
            )}
          >
            {i.label}
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <button
        type="button"
        className="rounded-lg px-2 py-1.5 text-sm font-medium ring-1 ring-stone-300 lg:hidden"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <div className="fixed inset-x-0 top-14 z-30 border-b border-stone-200 bg-white p-3 shadow-lg lg:hidden">
          {links}
          {footer && <div className="mt-3 border-t border-stone-100 pt-3">{footer}</div>}
        </div>
      )}
      <nav className="hidden lg:block">{links}</nav>
    </>
  );
}
