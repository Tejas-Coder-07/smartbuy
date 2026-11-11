import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignInForm } from "@/components/forms";
import { Notice, SetupNotice } from "@/components/ui";
import { safeNextPath } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/config";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="mx-auto max-w-md pt-6">
      <h1 className="text-3xl font-bold">Sign in</h1>
      <p className="mt-2 text-muted">Sign in to fetch live prices, save products and set price alerts.</p>
      <div className="panel mt-6 p-5">
        <Suspense fallback={<div className="skeleton h-56 w-full" aria-hidden="true" />}>
          <LoginBody searchParams={searchParams} />
        </Suspense>
      </div>
      <p className="mt-4 text-muted">
        New to SmartBuy? <Link href="/signup">Create an account</Link>
      </p>
    </div>
  );
}

async function LoginBody({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const notice = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  return (
    <div className="flex flex-col gap-4">
      {error === "link" ? (
        <Notice tone="danger">
          <p>That link has expired or was already used. Sign in, or request a new link.</p>
        </Notice>
      ) : null}
      {notice === "confirmed" ? (
        <Notice tone="good">
          <p>Your email address is confirmed. Sign in with the password you chose.</p>
        </Notice>
      ) : null}
      <SignInForm next={rawNext ? safeNextPath(rawNext) : undefined} />
    </div>
  );
}
