import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/forms";
import { Alert } from "@/components/ui";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">Choose a new password</h1>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert tone="red">This link is missing its token. <Link href="/forgot-password" className="underline">Request a new link</Link>.</Alert>
      )}
    </>
  );
}
