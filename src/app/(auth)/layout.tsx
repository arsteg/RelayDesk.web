import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-stone-50 px-4 py-12">
      <Link href="/" className="mb-6 flex items-center gap-2 text-xl font-semibold text-stone-900">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white">B</span>
        RelayDesk
      </Link>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200 sm:p-8">{children}</div>
    </div>
  );
}
