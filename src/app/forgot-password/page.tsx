import type { Metadata } from "next";
import Link from "next/link";
import { ResetRequestForm } from "@/components/forms";
import { SetupNotice } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/config";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-md pt-6">
      <h1 className="text-3xl font-bold">Reset your password</h1>
      <p className="mt-2 text-muted">Enter your account email and we will send a link to set a new password.</p>
      <div className="panel mt-6 p-5">{isSupabaseConfigured() ? <ResetRequestForm /> : <SetupNotice />}</div>
      <p className="mt-4 text-muted">
        <Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
