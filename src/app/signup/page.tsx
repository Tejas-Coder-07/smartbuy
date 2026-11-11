import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "@/components/forms";
import { SetupNotice } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/config";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <div className="mx-auto max-w-md pt-6">
      <h1 className="text-3xl font-bold">Create your account</h1>
      <p className="mt-2 text-muted">An account lets you fetch live prices, keep a watchlist and get price alerts by email.</p>
      <div className="panel mt-6 p-5">{isSupabaseConfigured() ? <SignUpForm /> : <SetupNotice />}</div>
      <p className="mt-4 text-muted">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  );
}
