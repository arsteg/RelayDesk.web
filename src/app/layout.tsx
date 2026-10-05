import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RelayDesk", template: "%s · RelayDesk" },
  description:
    "RelayDesk is order, client and payment management for small businesses that take custom and recurring orders — track deposits and balances, send branded invoices, and let customers order and follow their order live.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f97b10" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
