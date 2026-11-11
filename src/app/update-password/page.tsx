import type { Metadata } from "next";
import { UpdatePasswordForm } from "@/components/forms";
import { SetupNotice } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/config";

export const metadata: Metadata = { title: "Set a new password" };

export default function UpdatePasswordPage() {
  return (
    <div className="mx-auto max-w-md pt-6">
      <h1 className="text-3xl font-bold">Set a new password</h1>
      <p className="mt-2 text-muted">Choose a new password for your SmartBuy account.</p>
      <div className="panel mt-6 p-5">{isSupabaseConfigured() ? <UpdatePasswordForm /> : <SetupNotice />}</div>
    </div>
  );
}
