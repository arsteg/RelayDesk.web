import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { ResendVerification } from "./resend";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui";

export const metadata = { title: "Verify your email" };

export default async function VerifyEmailPage() {
  const user = await requireUser();
  if (user.emailVerifiedAt) redirect("/app");
  return (
    <>
      <h1 className="text-xl font-semibold">Check your inbox</h1>
      <p className="mt-2 text-sm text-stone-600">
        We sent a verification link to <strong>{user.email}</strong>. Click it to activate your workspace.
      </p>
      {process.env.NODE_ENV !== "production" && (
        <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">
          Development: emails are printed in the server console and saved to <code>.dev-mail/</code>.
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <ResendVerification />
        <form action={logoutAction}>
          <Button variant="ghost" type="submit">Sign out</Button>
        </form>
      </div>
    </>
  );
}
