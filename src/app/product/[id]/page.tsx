import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AlertForm, RefreshPricesButton, WatchButton } from "@/components/forms";
import { PriceChart } from "@/components/price-chart";
import { EmptyState, Notice, ProductImage, SetupNotice } from "@/components/ui";
import { getUser, isUuid } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/config";
import { CATEGORY_LABELS } from "@/lib/domain/categorise";
import { daysAgoIso, discountPct, formatDate, formatDateTime, formatINR, formatPct, timeAgo } from "@/lib/domain/format";
import { buildDailySeries, buildGuidance, computeStats, type Guidance } from "@/lib/domain/insights";
import type { ListingRow, ObservationRow, ProductRow } from "@/lib/domain/types";
import { variantLabel } from "@/lib/domain/variants";
import { bestOffer, comparableListings, isFresh, normaliseListing, normaliseProduct } from "@/lib/services/catalogue";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Product" };

const HISTORY_DAYS = 365;
const MAX_OBSERVATIONS = 5000;

export default function ProductPage({ params }: PageProps<"/product/[id]">) {
  return (
    <Suspense fallback={<ProductSkeleton />}>
      <ProductView params={params} />
    </Suspense>
  );
}

function ProductSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="skeleton h-56 w-56" />
        <div className="flex flex-1 flex-col gap-4">
          <div className="skeleton h-9 w-4/5" />
          <div className="skeleton h-5 w-1/3" />
          <div className="skeleton h-12 w-48" />
        </div>
      </div>
      <div className="skeleton h-64 w-full" />
    </div>
  );
}

async function ProductView({ params }: { params: Promise<{ id: string }> }) {
  // Prices and "last checked" times must always be rendered at request time.
  await connection();
  const { id } = await params;
  if (!isSupabaseConfigured()) return <SetupNotice />;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const since = daysAgoIso(HISTORY_DAYS);

  const [productResult, listingResult, observationResult, user] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("listings").select("*").eq("product_id", id),
    supabase
      .from("price_observations")
      .select("listing_id, price, observed_at")
      .eq("product_id", id)
      .gte("observed_at", since)
      .order("observed_at", { ascending: true })
      .limit(MAX_OBSERVATIONS),
    getUser(),
  ]);

  if (productResult.error) {
    return (
      <Notice tone="danger" title="This product could not be loaded">
        <p>Reload the page to try again.</p>
      </Notice>
    );
  }
  if (!productResult.data) notFound();

  const product = normaliseProduct(productResult.data as ProductRow);
  const listings = ((listingResult.data ?? []) as ListingRow[]).map(normaliseListing);
  const observations = ((observationResult.data ?? []) as ObservationRow[]).map((o) => ({ ...o, price: Number(o.price) }));

  const comparable = comparableListings(listings).sort((a, b) => (a.current_price ?? 0) - (b.current_price ?? 0));
  const otherVariants = listings
    .filter((l) => l.variant_match === "different" && l.current_price !== null)
    .sort((a, b) => (a.current_price ?? 0) - (b.current_price ?? 0));
  const best = bestOffer(listings);

  const comparableIds = new Set(comparable.map((l) => l.id));
  const series = buildDailySeries(observations, (listingId) => comparableIds.has(listingId));
  const stats = computeStats(series);
  const guidance = buildGuidance(stats);

  let watching = false;
  let alert: { id: string; target: number; listingId: string | null; status: string; triggeredAt: string | null; triggeredPrice: number | null } | null = null;
  if (user) {
    const [{ data: watch }, { data: alertRow }] = await Promise.all([
      supabase.from("watchlist_items").select("id").eq("product_id", id).eq("user_id", user.id).maybeSingle(),
      supabase
        .from("price_alerts")
        .select("id, target_price, listing_id, status, triggered_at, triggered_price")
        .eq("product_id", id)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    watching = Boolean(watch);
    if (alertRow) {
      alert = {
        id: alertRow.id,
        target: Number(alertRow.target_price),
        listingId: alertRow.listing_id,
        status: alertRow.status,
        triggeredAt: alertRow.triggered_at,
        triggeredPrice: alertRow.triggered_price === null ? null : Number(alertRow.triggered_price),
      };
    }
  }

  const variant = variantLabel(product.variant);
  const storeNames = new Set(comparable.map((l) => l.store_key));
  const suggestedTarget = best?.listing.current_price ? Math.floor((best.listing.current_price * 0.95) / 10) * 10 : null;

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        <ProductImage src={product.image_url} alt={product.title} size="detail" />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">{product.title}</h1>
            <p className="mt-2 text-muted">
              {[product.brand, CATEGORY_LABELS[product.category], variant || null, product.model ? `Model ${product.model}` : null]
                .filter(Boolean)
                .join(", ")}
              {product.rating ? `. Rated ${product.rating} out of 5` : ""}
              {product.rating && product.review_count ? ` from ${product.review_count.toLocaleString("en-IN")} reviews` : ""}
            </p>
          </div>

          {best && best.listing.current_price !== null ? (
            <div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="price-tag text-3xl">{formatINR(best.listing.current_price)}</span>
                <span className="text-muted">
                  lowest price, at <span className="font-medium text-ink">{best.listing.store}</span>
                </span>
              </div>
              <p className="mt-2 text-sm text-muted">
                Checked {formatDateTime(best.listing.last_observed_at)} ({timeAgo(best.listing.last_observed_at)}).
                {!best.fresh ? " This price is more than a day old; check prices again before deciding." : ""}
              </p>
            </div>
          ) : (
            <p className="text-muted">No price has been recorded for this product yet.</p>
          )}

          <GuidancePanel guidance={guidance} />

          <div className="flex flex-wrap items-start gap-3">
            <WatchButton productId={product.id} watching={watching} />
            <RefreshPricesButton productId={product.id} hasComparison={Boolean(product.offers_refreshed_at)} />
          </div>
          {!user ? (
            <p className="text-sm text-muted">
              <Link href={`/login?next=/product/${product.id}`}>Sign in</Link> to save this product, compare all stores
              live and set a price alert.
            </p>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="compare">
        <h2 id="compare" className="text-2xl font-bold">
          Prices by store
        </h2>
        <p className="mt-1 max-w-[70ch] text-muted">
          {product.offers_refreshed_at
            ? `All stores were last compared ${formatDateTime(product.offers_refreshed_at)}. ${storeNames.size} ${storeNames.size === 1 ? "store has" : "stores have"} a recorded price.`
            : "Only the store found in search is shown so far. Use “Compare all stores” to fetch every store’s price for this product."}
        </p>
        {comparable.length > 0 ? (
          <div className="panel mt-4 overflow-x-auto">
            <ListingTable listings={comparable} bestId={best?.listing.id ?? null} />
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState title="No store prices recorded yet" />
          </div>
        )}

        {otherVariants.length > 0 ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-accent">
              {otherVariants.length} offer{otherVariants.length === 1 ? "" : "s"} for a different variant (not compared above)
            </summary>
            <p className="mt-2 max-w-[70ch] text-sm text-muted">
              These offers state a different storage size, colour or size from this product, so they are left out of
              the comparison, the price history and alerts.
            </p>
            <div className="panel mt-3 overflow-x-auto">
              <ListingTable listings={otherVariants} bestId={null} />
            </div>
          </details>
        ) : null}
      </section>

      <section aria-labelledby="history">
        <h2 id="history" className="text-2xl font-bold">
          Price history
        </h2>
        {stats ? (
          <>
            <p className="mt-1 max-w-[70ch] text-muted">
              SmartBuy has recorded this product&apos;s price on {stats.days} day{stats.days === 1 ? "" : "s"} since{" "}
              {formatDate(stats.firstDay)}. History begins when SmartBuy first checks a product; earlier prices are not
              known.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 md:grid-cols-4">
              <Stat label="Highest recorded" value={formatINR(stats.high)} note={formatDate(stats.highDay)} />
              <Stat label="Lowest recorded" value={formatINR(stats.low)} note={formatDate(stats.lowDay)} />
              <Stat label="Average recorded" value={formatINR(Math.round(stats.average))} note={`over ${stats.days} day${stats.days === 1 ? "" : "s"}`} />
              <Stat
                label="30-day average"
                value={stats.average30 !== null ? formatINR(Math.round(stats.average30)) : "—"}
                note={
                  stats.vsAverage30Pct !== null
                    ? `now ${formatPct(stats.vsAverage30Pct)} against it`
                    : "needs two or more days"
                }
              />
            </dl>
            {stats.changes.length > 0 ? (
              <p className="mt-3 text-sm text-muted">
                Change in lowest price:{" "}
                {stats.changes
                  .map((c) => `${formatPct(c.pct)} over ${c.days} days (from ${formatINR(c.from)})`)
                  .join("; ")}
                .
              </p>
            ) : null}
            <div className="panel mt-4 p-4 sm:p-5">
              <PriceChart points={series.map((p) => ({ day: p.day, price: p.price }))} />
            </div>
          </>
        ) : (
          <div className="mt-4">
            <EmptyState title="No price history yet">
              <p>The graph appears once SmartBuy has recorded a price for this product.</p>
            </EmptyState>
          </div>
        )}
      </section>

      <section aria-labelledby="alert" className="max-w-2xl">
        <h2 id="alert" className="text-2xl font-bold">
          Price alert
        </h2>
        {user ? (
          <>
            <p className="mt-1 text-muted">
              {alert?.status === "active"
                ? `You have an alert at ${formatINR(alert.target)}. SmartBuy will email ${user.email ?? "you"} and show it on your dashboard when a freshly checked price reaches it.`
                : alert?.status === "triggered"
                  ? `Your alert at ${formatINR(alert.target)} was triggered${alert.triggeredPrice ? ` at ${formatINR(alert.triggeredPrice)}` : ""} on ${formatDate(alert.triggeredAt)}. Set a new target to be alerted again.`
                  : `Choose a target price. SmartBuy will email ${user.email ?? "you"} and show it on your dashboard when a freshly checked price reaches it.`}
            </p>
            <div className="panel mt-4 p-4 sm:p-5">
              <AlertForm
                productId={product.id}
                listings={comparable.map((l) => ({
                  id: l.id,
                  label: `${l.store} only (${formatINR(l.current_price)})`,
                }))}
                current={alert ? { target: alert.target, listingId: alert.listingId, status: alert.status } : null}
                suggested={suggestedTarget}
              />
            </div>
          </>
        ) : (
          <p className="mt-1 text-muted">
            <Link href={`/login?next=/product/${product.id}`}>Sign in</Link> to set a target price and be told when this
            product reaches it.
          </p>
        )}
      </section>
    </div>
  );
}

function GuidancePanel({ guidance }: { guidance: Guidance }) {
  const tone = {
    good: "border-good/40 bg-good-soft",
    fair: "border-line-strong bg-surface",
    high: "border-caution/40 bg-caution-soft",
    insufficient: "border-line-strong bg-surface",
  }[guidance.level];
  const mark = { good: "✓", fair: "•", high: "!", insufficient: "…" }[guidance.level];
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <p className="font-display text-lg font-bold">
        <span aria-hidden="true" className="mr-2 inline-block w-4 text-center">
          {mark}
        </span>
        {guidance.headline}
      </p>
      <p className="mt-1 text-[0.9375rem]">{guidance.detail}</p>
      <p className="mt-1 text-sm text-muted">
        Based only on prices SmartBuy has recorded. It is not a forecast of future prices.
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="price mt-0.5 text-2xl font-bold">{value}</dd>
      <dd className="text-sm text-muted">{note}</dd>
    </div>
  );
}

function isGoogleLink(url: string): boolean {
  try {
    return /(^|\.)google\.[a-z.]+$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function ListingTable({ listings, bestId }: { listings: ListingRow[]; bestId: string | null }) {
  return (
    <>
      <ul className="divide-y divide-line sm:hidden">
        {listings.map((l) => {
          const off = discountPct(l.current_price, l.mrp);
          const fresh = isFresh(l);
          const v = variantLabel(l.variant);
          return (
            <li key={l.id} className={`px-4 py-3 ${fresh ? "" : "text-muted"}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">
                  {l.store}
                  {l.id === bestId ? (
                    <span className="ml-2 rounded-full bg-tag px-2 py-0.5 text-xs font-semibold text-tag-ink">Lowest</span>
                  ) : null}
                </span>
                <span className="price text-lg font-bold">{formatINR(l.current_price)}</span>
              </div>
              <p className="mt-1 text-sm">{l.title}</p>
              <p className="mt-0.5 text-sm text-muted">
                {[v, l.mrp ? `List price ${formatINR(l.mrp)}${off ? ` (${off}% off)` : ""}` : null, l.shipping, l.detail]
                  .filter(Boolean)
                  .join("; ")}
              </p>
              <p className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="text-muted">
                  Checked {timeAgo(l.last_observed_at)}
                  {!fresh ? ", may be out of date" : ""}
                </span>
                {l.url ? (
                  <a href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                    {isGoogleLink(l.url) ? "View on Google Shopping" : "View at store"}
                    <span className="sr-only"> ({l.store}, opens in a new tab)</span>
                  </a>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
      <DesktopListingTable listings={listings} bestId={bestId} />
    </>
  );
}

function DesktopListingTable({ listings, bestId }: { listings: ListingRow[]; bestId: string | null }) {
  return (
    <table className="data hidden sm:table">
      <thead>
        <tr>
          <th scope="col">Store</th>
          <th scope="col">Offer</th>
          <th scope="col" style={{ textAlign: "right" }}>
            Price
          </th>
          <th scope="col" style={{ textAlign: "right" }}>
            List price
          </th>
          <th scope="col">Last checked</th>
          <th scope="col">
            <span className="sr-only">Link</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {listings.map((l) => {
          const off = discountPct(l.current_price, l.mrp);
          const fresh = isFresh(l);
          const v = variantLabel(l.variant);
          return (
            <tr key={l.id} className={fresh ? "" : "text-muted"}>
              <th scope="row" className="whitespace-nowrap text-left font-semibold">
                {l.store}
                {l.id === bestId ? (
                  <span className="ml-2 rounded-full bg-tag px-2 py-0.5 text-xs font-semibold text-tag-ink">Lowest</span>
                ) : null}
              </th>
              <td className="min-w-[14rem]">
                <span className="line-clamp-2">{l.title}</span>
                {v ? <span className="mt-0.5 block text-sm text-muted">{v}</span> : null}
                {l.shipping || l.detail ? (
                  <span className="mt-0.5 block text-sm text-muted">{[l.shipping, l.detail].filter(Boolean).join("; ")}</span>
                ) : null}
              </td>
              <td className="num price text-base font-bold">{formatINR(l.current_price)}</td>
              <td className="num">
                {l.mrp ? (
                  <>
                    <span className="line-through">{formatINR(l.mrp)}</span>
                    {off ? <span className="block text-sm text-good">{off}% off</span> : null}
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="whitespace-nowrap">
                {timeAgo(l.last_observed_at)}
                {!fresh ? <span className="block text-sm">may be out of date</span> : null}
              </td>
              <td className="whitespace-nowrap">
                {l.url ? (
                  <a href={l.url} target="_blank" rel="noopener noreferrer nofollow">
                    {isGoogleLink(l.url) ? "View on Google Shopping" : "View at store"}
                    <span className="sr-only"> ({l.store}, opens in a new tab)</span>
                  </a>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
