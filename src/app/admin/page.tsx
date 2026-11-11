import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { RunCollectionButton } from "@/components/forms";
import { Notice, PageHeading, SetupNotice } from "@/components/ui";
import { getIsAdmin, getUser } from "@/lib/auth";
import { cronSecret, gmailConfig, isSupabaseConfigured, settings, supabaseSecretKey } from "@/lib/config";
import { formatDateTime, timeAgo } from "@/lib/domain/format";
import { getProvider } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <div>
      <PageHeading title="Administration" lead="Users, search activity, data sources, collection jobs and data freshness." />
      <Suspense fallback={<div className="skeleton h-96 w-full" aria-hidden="true" />}>
        <Admin />
      </Suspense>
    </div>
  );
}

type Overview = Record<string, number | string | null>;

type RunRow = {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  products_checked: number;
  observations_written: number;
  alerts_triggered: number;
  failures: number;
  note: string | null;
  error_log: { product_id?: string; title?: string; error?: string }[];
};

function n(overview: Overview, key: string): number {
  const v = overview[key];
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function Admin() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const user = await getUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await getIsAdmin())) {
    return (
      <Notice tone="caution" title="This page is for administrators">
        <p>
          You are signed in as {user.email ?? "a member"}, which is not on the administrator list.{" "}
          <Link href="/dashboard">Go to your dashboard</Link>.
        </p>
      </Notice>
    );
  }

  const supabase = await createClient();
  const [overviewResult, runsResult, searchesResult, usersResult, failuresResult, storesResult] = await Promise.all([
    supabase.rpc("admin_overview"),
    supabase.from("collection_runs").select("*").order("started_at", { ascending: false }).limit(15),
    supabase.from("searches").select("id, query, result_count, from_cache, created_at, user_id").order("created_at", { ascending: false }).limit(25),
    supabase.from("profiles").select("id, email, full_name, created_at").order("created_at", { ascending: false }).limit(25),
    supabase.from("provider_calls").select("id, provider, kind, status_code, error, created_at").eq("ok", false).order("created_at", { ascending: false }).limit(10),
    supabase.from("listings").select("store, store_key, last_observed_at").order("last_observed_at", { ascending: false }).limit(2000),
  ]);

  if (overviewResult.error) {
    return (
      <Notice tone="danger" title="The admin overview could not be loaded">
        <p>{overviewResult.error.message}</p>
      </Notice>
    );
  }

  const overview = (overviewResult.data ?? {}) as Overview;
  const runs = (runsResult.data ?? []) as RunRow[];
  const searches = (searchesResult.data ?? []) as { id: number; query: string; result_count: number; from_cache: boolean; created_at: string; user_id: string | null }[];
  const users = (usersResult.data ?? []) as { id: string; email: string | null; full_name: string | null; created_at: string }[];
  const failures = (failuresResult.data ?? []) as { id: number; provider: string; kind: string; status_code: number | null; error: string | null; created_at: string }[];
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  const byStore = new Map<string, { name: string; listings: number; latest: string | null }>();
  for (const l of (storesResult.data ?? []) as { store: string; store_key: string; last_observed_at: string | null }[]) {
    const s = byStore.get(l.store_key) ?? { name: l.store, listings: 0, latest: null };
    s.listings += 1;
    if (l.last_observed_at && (!s.latest || l.last_observed_at > s.latest)) s.latest = l.last_observed_at;
    byStore.set(l.store_key, s);
  }
  const stores = Array.from(byStore.values()).sort((a, b) => b.listings - a.listings);

  const provider = getProvider();
  const monthlyLimit = settings.providerMonthlyLimit();
  const usedThisMonth = n(overview, "provider_calls_month");
  const email = gmailConfig();
  const lastRun = runs[0];

  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="usage">
        <h2 id="usage" className="text-2xl font-bold">
          Application usage
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-5 md:grid-cols-4">
          <Figure label="Registered users" value={n(overview, "users")} note={`${n(overview, "users_7d")} joined in the last 7 days`} />
          <Figure label="Searches, last 7 days" value={n(overview, "searches_7d")} note={`${n(overview, "searches_total")} in total`} />
          <Figure label="Tracked products" value={n(overview, "tracked_products")} note={`${n(overview, "watchlist_items")} watchlist saves`} />
          <Figure label="Active price alerts" value={n(overview, "active_alerts")} note={`${n(overview, "triggered_alerts")} reached so far`} />
          <Figure label="Products" value={n(overview, "products")} note={`${n(overview, "listings")} store listings`} />
          <Figure
            label="Price observations"
            value={n(overview, "observations")}
            note={
              overview.first_observation_at
                ? `${n(overview, "observations_24h")} in the last 24 hours`
                : "Collection has not started"
            }
          />
          <Figure
            label="History began"
            value={overview.first_observation_at ? timeAgo(String(overview.first_observation_at)) : "—"}
            note={overview.first_observation_at ? formatDateTime(String(overview.first_observation_at)) : "No observations yet"}
          />
          <Figure label="Database size" value={megabytes(n(overview, "database_bytes"))} note="Supabase Free allows 500 MB" />
        </dl>
      </section>

      <section aria-labelledby="sources">
        <h2 id="sources" className="text-2xl font-bold">
          Data source and services
        </h2>
        <div className="panel mt-4 overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Status</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="text-left font-semibold">
                  {provider.name}
                </th>
                <td>
                  <Status ok={provider.isConfigured()} yes="Connected" no="Key missing" />
                </td>
                <td>
                  {usedThisMonth} of {monthlyLimit} lookups used this month.{" "}
                  {overview.last_provider_success_at ? `Last success ${timeAgo(String(overview.last_provider_success_at))}. ` : "No successful lookup yet. "}
                  {n(overview, "provider_failures_7d") > 0
                    ? `${n(overview, "provider_failures_7d")} failed lookup(s) in the last 7 days, most recent ${timeAgo(String(overview.last_provider_failure_at))}.`
                    : "No failures in the last 7 days."}
                </td>
              </tr>
              <tr>
                <th scope="row" className="text-left font-semibold">
                  Database writes
                </th>
                <td>
                  <Status ok={Boolean(supabaseSecretKey())} yes="Connected" no="Secret key missing" />
                </td>
                <td>
                  {supabaseSecretKey()
                    ? "Prices, searches and alerts are being stored."
                    : "Set SUPABASE_SECRET_KEY so the server can store prices, searches and alerts."}
                </td>
              </tr>
              <tr>
                <th scope="row" className="text-left font-semibold">
                  Alert emails (Gmail)
                </th>
                <td>
                  <Status ok={Boolean(email)} yes="Connected" no="Not set up" />
                </td>
                <td>
                  {email ? `Sending as ${email.fromName} <${email.user}>. ` : "Alerts appear in-app only until GMAIL_USER and GMAIL_APP_PASSWORD are set. "}
                  {n(overview, "emails_failed_7d") > 0 ? `${n(overview, "emails_failed_7d")} email(s) failed in the last 7 days.` : ""}
                </td>
              </tr>
              <tr>
                <th scope="row" className="text-left font-semibold">
                  Scheduled collection
                </th>
                <td>
                  <Status ok={Boolean(cronSecret())} yes="Enabled" no="CRON_SECRET missing" />
                </td>
                <td>
                  Runs daily at 7:00 am IST and refreshes up to {settings.collectMaxProducts()} tracked products per run.{" "}
                  {lastRun ? `Last run ${timeAgo(lastRun.started_at)} (${lastRun.status}).` : "No run recorded yet."}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="freshness">
        <h2 id="freshness" className="text-2xl font-bold">
          Data freshness
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-5 border-y border-line py-5 sm:grid-cols-3">
          <Figure label="Checked in the last 24 hours" value={n(overview, "listings_fresh_24h")} note="store listings" />
          <Figure label="Checked 1 to 7 days ago" value={n(overview, "listings_1_to_7d")} note="store listings" />
          <Figure label="Not checked for over 7 days" value={n(overview, "listings_stale_7d")} note="store listings" />
        </dl>
        {stores.length > 0 ? (
          <div className="panel mt-4 overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">Store</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Listings
                  </th>
                  <th scope="col">Most recent price check</th>
                </tr>
              </thead>
              <tbody>
                {stores.slice(0, 20).map((s) => (
                  <tr key={s.name}>
                    <td className="font-medium">{s.name}</td>
                    <td className="num">{s.listings}</td>
                    <td>{s.latest ? `${timeAgo(s.latest)} (${formatDateTime(s.latest)})` : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="runs">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <h2 id="runs" className="text-2xl font-bold">
              Price-collection jobs
            </h2>
            <p className="mt-1 max-w-[62ch] text-muted">
              Each run refreshes the tracked products checked longest ago, then evaluates price alerts.
            </p>
          </div>
          <div className="ml-auto">
            <RunCollectionButton />
          </div>
        </div>
        <div className="mt-4">
          {runs.length === 0 ? (
            <p className="text-muted">No collection run has been recorded yet.</p>
          ) : (
            <div className="panel overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Started</th>
                    <th scope="col">Trigger</th>
                    <th scope="col">Status</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Products
                    </th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Observations
                    </th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Alerts
                    </th>
                    <th scope="col">Failures and notes</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{formatDateTime(r.started_at)}</td>
                      <td>{r.trigger === "cron" ? "Scheduled" : "Manual"}</td>
                      <td>
                        <RunStatus status={r.status} />
                      </td>
                      <td className="num">{r.products_checked}</td>
                      <td className="num">{r.observations_written}</td>
                      <td className="num">{r.alerts_triggered}</td>
                      <td className="min-w-[16rem]">
                        {r.note ? <span className="block">{r.note}</span> : null}
                        {r.failures > 0 ? (
                          <details>
                            <summary className="cursor-pointer text-danger">
                              {r.failures} failure{r.failures === 1 ? "" : "s"}
                            </summary>
                            <ul className="mt-1 list-disc pl-5 text-sm">
                              {(r.error_log ?? []).map((e, i) => (
                                <li key={i}>
                                  {e.title ? `${e.title}: ` : ""}
                                  {e.error}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : !r.note ? (
                          <span className="text-muted">None</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {failures.length > 0 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-accent">Recent failed data-source lookups ({failures.length})</summary>
            <div className="panel mt-3 overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Lookup</th>
                    <th scope="col">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {failures.map((f) => (
                    <tr key={f.id}>
                      <td className="whitespace-nowrap">{formatDateTime(f.created_at)}</td>
                      <td className="whitespace-nowrap">
                        {f.kind === "search" ? "Search" : "Store offers"}
                        {f.status_code ? ` (HTTP ${f.status_code})` : ""}
                      </td>
                      <td>{f.error ?? "Unknown error"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </section>

      <div className="grid gap-12 lg:grid-cols-2">
        <section aria-labelledby="activity">
          <h2 id="activity" className="text-2xl font-bold">
            Search activity
          </h2>
          <div className="mt-4">
            {searches.length === 0 ? (
              <p className="text-muted">No searches yet.</p>
            ) : (
              <div className="panel overflow-x-auto">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Query</th>
                      <th scope="col">By</th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Results
                      </th>
                      <th scope="col">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searches.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link href={`/search?q=${encodeURIComponent(s.query)}`} className="text-ink">
                            {s.query}
                          </Link>
                          <span className="block text-sm text-muted">{s.from_cache ? "Saved results" : "Live lookup"}</span>
                        </td>
                        <td className="max-w-[12rem] truncate">{s.user_id ? (emailById.get(s.user_id) ?? "Member") : "Visitor"}</td>
                        <td className="num">{s.result_count}</td>
                        <td className="whitespace-nowrap">{timeAgo(s.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="users">
          <h2 id="users" className="text-2xl font-bold">
            Registered users
          </h2>
          <div className="mt-4">
            {users.length === 0 ? (
              <p className="text-muted">No users yet.</p>
            ) : (
              <div className="panel overflow-x-auto">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">Email</th>
                      <th scope="col">Name</th>
                      <th scope="col">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="max-w-[16rem] truncate">{u.email ?? "—"}</td>
                        <td>{u.full_name ?? "—"}</td>
                        <td className="whitespace-nowrap">{timeAgo(u.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {n(overview, "users") > users.length ? (
              <p className="mt-2 text-sm text-muted">
                Showing the {users.length} most recent of {n(overview, "users")} users.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="price mt-0.5 text-3xl font-bold">{typeof value === "number" ? value.toLocaleString("en-IN") : value}</dd>
      <dd className="text-sm text-muted">{note}</dd>
    </div>
  );
}

function Status({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-sm font-medium ${ok ? "bg-good-soft text-good" : "bg-caution-soft text-caution"}`}>
      <span aria-hidden="true">{ok ? "✓ " : "! "}</span>
      {ok ? yes : no}
    </span>
  );
}

function RunStatus({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; mark: string }> = {
    success: { label: "Success", cls: "bg-good-soft text-good", mark: "✓ " },
    partial: { label: "Partly failed", cls: "bg-caution-soft text-caution", mark: "! " },
    failed: { label: "Failed", cls: "bg-danger-soft text-danger", mark: "✕ " },
    skipped: { label: "Skipped", cls: "bg-paper text-muted", mark: "" },
    running: { label: "Running", cls: "bg-accent-soft text-accent-strong", mark: "" },
  };
  const s = map[status] ?? { label: status, cls: "bg-paper text-muted", mark: "" };
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-sm font-medium ${s.cls}`}>
      <span aria-hidden="true">{s.mark}</span>
      {s.label}
    </span>
  );
}
