import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { deleteAlert, markNotificationsRead, removeFromWatchlist } from "@/app/actions";
import { EmptyState, PageHeading, ProductImage, SetupNotice } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/config";
import { daysAgoIso, formatDate, formatDateTime, formatINR, formatPct, timeAgo } from "@/lib/domain/format";
import { buildDailySeries, computeStats } from "@/lib/domain/insights";
import type { ListingRow, ObservationRow, ProductWithListings } from "@/lib/domain/types";
import { bestOffer, comparableListings, normaliseListing, normaliseProduct } from "@/lib/services/catalogue";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div>
      <PageHeading title="Your dashboard" lead="Saved products, price alerts and recent searches." />
      <Suspense fallback={<div className="skeleton h-96 w-full" aria-hidden="true" />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

type AlertRow = {
  id: string;
  product_id: string;
  listing_id: string | null;
  target_price: number;
  status: "active" | "triggered" | "paused";
  triggered_at: string | null;
  triggered_price: number | null;
  triggered_store: string | null;
  created_at: string;
};

type NotificationRow = {
  id: string;
  product_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  email_status: string;
  created_at: string;
};

async function Dashboard() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  const user = await getUser();
  if (!user) redirect("/login?next=/dashboard");

  const supabase = await createClient();
  const [watchResult, alertResult, noteResult, searchResult] = await Promise.all([
    supabase.from("watchlist_items").select("product_id, created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("price_alerts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("notifications").select("id, product_id, title, body, read_at, email_status, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("searches").select("id, query, result_count, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(12),
  ]);

  const watchIds = ((watchResult.data ?? []) as { product_id: string }[]).map((w) => w.product_id);
  const alerts = ((alertResult.data ?? []) as AlertRow[]).map((a) => ({
    ...a,
    target_price: Number(a.target_price),
    triggered_price: a.triggered_price === null ? null : Number(a.triggered_price),
  }));
  const notifications = (noteResult.data ?? []) as NotificationRow[];
  const searches = (searchResult.data ?? []) as { id: number; query: string; result_count: number; created_at: string }[];

  const productIds = Array.from(new Set([...watchIds, ...alerts.map((a) => a.product_id)]));
  let products = new Map<string, ProductWithListings>();
  let observations: (ObservationRow & { product_id: string })[] = [];
  if (productIds.length > 0) {
    const since = daysAgoIso(120);
    const [{ data: productRows }, { data: observationRows }] = await Promise.all([
      supabase.from("products").select("*, listings(*)").in("id", productIds),
      supabase
        .from("price_observations")
        .select("listing_id, product_id, price, observed_at")
        .in("product_id", productIds)
        .gte("observed_at", since)
        .order("observed_at", { ascending: true })
        .limit(8000),
    ]);
    products = new Map(
      ((productRows ?? []) as ProductWithListings[]).map((p) => [
        p.id,
        { ...normaliseProduct(p), listings: (p.listings ?? []).map(normaliseListing) },
      ]),
    );
    observations = ((observationRows ?? []) as (ObservationRow & { product_id: string })[]).map((o) => ({ ...o, price: Number(o.price) }));
  }

  const unread = notifications.filter((n) => !n.read_at);
  const alertByProduct = new Map(alerts.map((a) => [a.product_id, a]));

  return (
    <div className="flex flex-col gap-12">
      {notifications.length > 0 ? (
        <section aria-labelledby="notes">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 id="notes" className="text-2xl font-bold">
              Price alerts received
            </h2>
            {unread.length > 0 ? (
              <form action={markNotificationsRead} className="ml-auto">
                <button type="submit" className="btn btn-quiet btn-small">
                  Mark all as read
                </button>
              </form>
            ) : null}
          </div>
          <ul className="panel divide-y divide-line">
            {notifications.map((n) => (
              <li key={n.id} className={`px-4 py-3 ${n.read_at ? "" : "bg-accent-soft/60"}`}>
                <p className="font-semibold">
                  {n.product_id ? (
                    <Link href={`/product/${n.product_id}`} className="text-ink">
                      {n.title}
                    </Link>
                  ) : (
                    n.title
                  )}
                  {!n.read_at ? <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">New</span> : null}
                </p>
                <p className="mt-0.5 text-[0.9375rem]">{n.body}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {formatDateTime(n.created_at)}.{" "}
                  {n.email_status === "sent"
                    ? "Email sent."
                    : n.email_status === "failed"
                      ? "The email could not be delivered."
                      : n.email_status === "skipped"
                        ? "Shown here only; email is not set up."
                        : "Email pending."}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="watchlist">
        <h2 id="watchlist" className="text-2xl font-bold">
          Watchlist and tracked prices
        </h2>
        <p className="mt-1 max-w-[70ch] text-muted">
          Saved products are checked on a schedule, so their price history keeps growing while you are away.
        </p>
        <div className="mt-4">
          {watchIds.length === 0 ? (
            <EmptyState title="Your watchlist is empty">
              <p>
                <Link href="/">Search for a product</Link> and choose “Save to watchlist” to start tracking its price.
              </p>
            </EmptyState>
          ) : (
            <div className="panel overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Lowest price now
                    </th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Recorded low / high
                    </th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      30-day change
                    </th>
                    <th scope="col">Alert</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {watchIds.map((id) => {
                    const product = products.get(id);
                    if (!product) return null;
                    return (
                      <WatchRow
                        key={id}
                        product={product}
                        observations={observations.filter((o) => o.product_id === id)}
                        alert={alertByProduct.get(id) ?? null}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="alerts">
        <h2 id="alerts" className="text-2xl font-bold">
          Price alerts
        </h2>
        <div className="mt-4">
          {alerts.length === 0 ? (
            <EmptyState title="No price alerts yet">
              <p>Open a product and set a target price. You will get an email when a checked price reaches it.</p>
            </EmptyState>
          ) : (
            <div className="panel overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col" style={{ textAlign: "right" }}>
                      Target
                    </th>
                    <th scope="col">Store</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => {
                    const product = products.get(a.product_id);
                    const listing = a.listing_id ? product?.listings.find((l: ListingRow) => l.id === a.listing_id) : null;
                    return (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/product/${a.product_id}`} className="font-medium text-ink">
                            {product?.title ?? "Product"}
                          </Link>
                        </td>
                        <td className="num price font-bold">{formatINR(a.target_price)}</td>
                        <td>{listing ? `${listing.store} only` : "Any store"}</td>
                        <td>
                          {a.status === "active" ? (
                            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-sm font-medium text-accent-strong">Watching</span>
                          ) : a.status === "triggered" ? (
                            <span>
                              <span className="rounded-full bg-good-soft px-2 py-0.5 text-sm font-medium text-good">Reached</span>
                              <span className="mt-1 block text-sm text-muted">
                                {a.triggered_price ? `${formatINR(a.triggered_price)}${a.triggered_store ? ` at ${a.triggered_store}` : ""}, ` : ""}
                                {formatDate(a.triggered_at)}
                              </span>
                            </span>
                          ) : (
                            "Paused"
                          )}
                        </td>
                        <td className="whitespace-nowrap text-right">
                          <form action={deleteAlert}>
                            <input type="hidden" name="alert_id" value={a.id} />
                            <button type="submit" className="btn btn-quiet btn-small">
                              Delete alert
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="searches">
        <h2 id="searches" className="text-2xl font-bold">
          Recent searches
        </h2>
        <div className="mt-4">
          {searches.length === 0 ? (
            <EmptyState title="No searches yet">
              <p>Your recent searches will be listed here so you can run them again.</p>
            </EmptyState>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {searches.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/search?q=${encodeURIComponent(s.query)}`}
                    className="inline-block rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink no-underline hover:border-ink"
                  >
                    {s.query}
                    <span className="ml-2 text-muted">{timeAgo(s.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function WatchRow({
  product,
  observations,
  alert,
}: {
  product: ProductWithListings;
  observations: ObservationRow[];
  alert: AlertRow | null;
}) {
  const best = bestOffer(product.listings);
  const ids = new Set(comparableListings(product.listings).map((l) => l.id));
  const stats = computeStats(buildDailySeries(observations, (id) => ids.has(id)));
  const change30 = stats?.changes.find((c) => c.days === 30) ?? null;

  return (
    <tr>
      <td className="min-w-[11rem] sm:min-w-[18rem]">
        <div className="flex items-center gap-3">
          <span className="hidden sm:block">
            <ProductImage src={product.image_url} alt="" size="card" />
          </span>
          <div>
            <Link href={`/product/${product.id}`} className="font-medium text-ink">
              {product.title}
            </Link>
            <span className="mt-0.5 block text-sm text-muted">
              {stats ? `${stats.days} day${stats.days === 1 ? "" : "s"} of history` : "No history yet"}
            </span>
          </div>
        </div>
      </td>
      <td className="num">
        {best && best.listing.current_price !== null ? (
          <>
            <span className="price text-base font-bold">{formatINR(best.listing.current_price)}</span>
            <span className="block text-sm text-muted">
              {best.listing.store}, {timeAgo(best.listing.last_observed_at)}
            </span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="num">{stats ? `${formatINR(stats.low)} / ${formatINR(stats.high)}` : "—"}</td>
      <td className="num">
        {change30 ? (
          <span className={change30.pct < 0 ? "text-good" : change30.pct > 0 ? "text-caution" : ""}>{formatPct(change30.pct)}</span>
        ) : (
          <span className="text-muted">Not enough history</span>
        )}
      </td>
      <td className="whitespace-nowrap">
        {alert?.status === "active" ? `At ${formatINR(alert.target_price)}` : alert?.status === "triggered" ? "Reached" : <Link href={`/product/${product.id}#alert`}>Set alert</Link>}
      </td>
      <td className="whitespace-nowrap text-right">
        <form action={removeFromWatchlist}>
          <input type="hidden" name="product_id" value={product.id} />
          <button type="submit" className="btn btn-quiet btn-small">
            Remove
          </button>
        </form>
      </td>
    </tr>
  );
}
