import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-stone-500">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      <ButtonLink href="/" className="mt-6">Go home</ButtonLink>
    </main>
  );
}
