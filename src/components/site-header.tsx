import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/actions";
import { getIsAdmin, getUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-ink no-underline hover:text-ink" aria-label="SmartBuy home">
          <span aria-hidden="true" className="price-tag text-sm" style={{ padding: "0.3rem 0.55rem 0.3rem 1.35rem" }}>
            ₹
          </span>
          <span className="font-display text-xl font-bold tracking-tight">SmartBuy</span>
        </Link>

        <form action="/search" method="get" role="search" className="order-3 flex w-full gap-2 sm:order-none sm:w-auto sm:flex-1">
          <label htmlFor="header-search" className="sr-only">
            Search products
          </label>
          <input
            id="header-search"
            name="q"
            type="search"
            placeholder="Search a product, model or description"
            className="field min-w-0 flex-1 py-2"
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary py-2">
            Search
          </button>
        </form>

        <nav aria-label="Account" className="ml-auto flex items-center gap-4 text-[0.9375rem]">
          <Suspense fallback={<span className="skeleton block h-5 w-28" aria-hidden="true" />}>
            <AccountNav />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}

async function AccountNav() {
  const user = await getUser();

  if (!user) {
    return (
      <>
        <Link href="/login" className="font-medium text-ink no-underline hover:underline">
          Sign in
        </Link>
        <Link href="/signup" className="btn btn-quiet btn-small">
          Create account
        </Link>
      </>
    );
  }

  const [isAdmin, unread] = await Promise.all([getIsAdmin(), unreadCount(user.id)]);

  return (
    <>
      <Link href="/dashboard" className="font-medium text-ink no-underline hover:underline">
        Dashboard
        {unread > 0 ? (
          <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-white">
            {unread}
            <span className="sr-only"> unread price alerts</span>
          </span>
        ) : null}
      </Link>
      {isAdmin ? (
        <Link href="/admin" className="font-medium text-ink no-underline hover:underline">
          Admin
        </Link>
      ) : null}
      <form action={signOut}>
        <button type="submit" className="btn btn-quiet btn-small">
          Sign out
        </button>
      </form>
    </>
  );
}

async function unreadCount(userId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  return count ?? 0;
}
