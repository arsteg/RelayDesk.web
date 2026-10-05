import { ConfirmEmailForm } from "@/components/auth/forms";
import { Alert } from "@/components/ui";

export const metadata = { title: "Confirm email" };

// Verification happens on POST (button) so link scanners that prefetch
// URLs cannot consume the single-use token.
export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="mb-2 text-xl font-semibold">Confirm your email</h1>
      <p className="mb-6 text-sm text-stone-600">One click and you&apos;re ready to bake.</p>
      {token ? <ConfirmEmailForm token={token} /> : <Alert tone="red">This link is missing its token.</Alert>}
    </>
  );
}
