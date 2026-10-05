import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/forms";
import { Alert } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { signupEnabled } from "@/lib/features";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  if (await getSession()) redirect("/app");
  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-stone-500">Welcome back to your business.</p>
      {sp.reset && <Alert tone="green" className="mb-4">Password updated. Sign in with your new password.</Alert>}
      {sp.verified && <Alert tone="green" className="mb-4">Email verified. You can sign in now.</Alert>}
      <LoginForm next={sp.next} />
      {signupEnabled() && (
        <p className="mt-6 text-center text-sm text-stone-500">
          New to RelayDesk? <Link href="/register" className="font-medium text-brand-700 hover:underline">Create an account</Link>
        </p>
      )}
    </>
  );
}
