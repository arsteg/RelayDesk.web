import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { RegisterForm } from "@/components/auth/forms";
import { billingEnabled, signupEnabled } from "@/lib/features";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  // SIGNUP_ENABLED is read at request time, not baked in when the page is prerendered.
  await connection();
  if (!signupEnabled()) redirect("/login");
  return (
    <>
      <h1 className="text-xl font-semibold">Create your business workspace</h1>
      <p className="mb-6 mt-1 text-sm text-stone-500">{billingEnabled() ? "Free 14-day trial. No card required." : "Set up your business in a minute."}</p>
      <RegisterForm />
      <p className="mt-6 text-center text-sm text-stone-500">
        Already have an account? <Link href="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link>
      </p>
    </>
  );
}
