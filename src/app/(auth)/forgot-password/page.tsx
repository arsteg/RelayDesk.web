import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forms";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mb-6 mt-1 text-sm text-stone-500">We&apos;ll email you a link to choose a new password.</p>
      <ForgotPasswordForm />
      <p className="mt-6 text-center text-sm"><Link href="/login" className="text-brand-700 hover:underline">Back to sign in</Link></p>
    </>
  );
}
