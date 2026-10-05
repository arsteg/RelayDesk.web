"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/api/customer-session";

export default function OrderIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getSession() ? "/order/menu" : "/order/login");
  }, [router]);
  return <p className="text-sm text-stone-500">Loading…</p>;
}
