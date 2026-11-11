import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CardListSkeleton, EmptyState, Notice, ProductCard, SetupNotice } from "@/components/ui";
import { getUser } from "@/lib/auth";
import { CATEGORY_LABELS } from "@/lib/domain/categorise";
import { formatINR, timeAgo } from "@/lib/domain/format";
import type { Category, ProductWithListings } from "@/lib/domain/types";
import { bestOffer, comparableListings } from "@/lib/services/catalogue";
import { runSearch, type SearchOutcome } from "@/lib/services/search";

export const metadata: Metadata = { title: "Search" };

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string {
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

function rupees(value: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <Suspense
      fallback={
        <div>
          <div className="skeleton mb-6 h-10 w-2/3" />
          <CardListSkeleton count={6} />
        </div>
      }
    >
      <Results searchParams={searchParams} />
    </Suspense>
  );
}

async function Results({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const q = one(params, "q");

  if (!q) {
    return (
      <EmptyState title="Search for a product">
        <p>Type a product name, a model number or a description such as “wireless earbuds under 3000”.</p>
      </EmptyState>
    );
  }

  const user = await getUser();
  const outcome = await runSearch(q, user?.id ?? null);
  const { parsed } = outcome;

  if (outcome.notice?.kind === "setup") {
    return <SetupNotice />;
  }

  // Filters: the URL wins; the parsed query supplies sensible defaults.
  const category = one(params, "category");
  const brand = one(params, "brand");
  const store = one(params, "store") || parsed.storeKey || "";
  const min = rupees(one(params, "min")) ?? parsed.minPrice;
  const max = rupees(one(params, "max")) ?? parsed.maxPrice;
  const sort = one(params, "sort") || parsed.sort || "relevance";

  const facets = buildFacets(outcome.products);

  let shown = outcome.products
    .map((product) => {
      const pool = store ? product.listings.filter((l) => l.store_key === store) : product.listings;
      return { product, best: bestOffer(pool) };
    })
    .filter(({ product, best }) => {
      if (category && product.category !== category) return false;
      if (brand && (product.brand ?? "") !== brand) return false;
      if (store && !best) return false;
      const price = best?.listing.current_price ?? null;
      if (min !== undefined && (price === null || price < min)) return false;
      if (max !== undefined && (price === null || price > max)) return false;
      return true;
    });

  if (sort === "price_asc" || sort === "price_desc") {
    const dir = sort === "price_asc" ? 1 : -1;
    shown = [...shown].sort(
      (a, b) => dir * ((a.best?.listing.current_price ?? Infinity) - (b.best?.listing.current_price ?? Infinity)),
    );
  }

  const understood: string[] = [];
  if (parsed.text !== parsed.raw.toLowerCase()) understood.push(`searching for “${parsed.text}”`);
  if (min !== undefined && max !== undefined) understood.push(`priced ${formatINR(min)} to ${formatINR(max)}`);
  else if (max !== undefined) understood.push(`priced up to ${formatINR(max)}`);
  else if (min !== undefined) understood.push(`priced from ${formatINR(min)}`);
  if (store) understood.push(`sold on ${facets.stores.find((s) => s.key === store)?.name ?? parsed.storeName ?? store}`);

  const filtersActive = Boolean(category || brand || one(params, "store") || one(params, "min") || one(params, "max") || one(params, "sort"));

  return (
    <div>
      <h1 className="text-3xl font-bold sm:text-4xl">Results for “{parsed.raw}”</h1>
      <p className="mt-2 text-muted">
        {understood.length > 0 ? `Understood as ${understood.join(", ")}. ` : ""}
        <SourceLine outcome={outcome} />
      </p>

      {outcome.notice ? (
        <div className="mt-4">
          <SearchNotice outcome={outcome} q={q} />
        </div>
      ) : null}

      {outcome.products.length > 0 ? (
        <form action="/search" method="get" className="panel mt-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filter results">
          <input type="hidden" name="q" value={q} />
          <div>
            <label htmlFor="f-category" className="mb-1 block text-sm font-medium">
              Category
            </label>
            <select id="f-category" name="category" defaultValue={category} className="field py-2">
              <option value="">All categories</option>
              {facets.categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-brand" className="mb-1 block text-sm font-medium">
              Brand
            </label>
            <select id="f-brand" name="brand" defaultValue={brand} className="field py-2">
              <option value="">All brands</option>
              {facets.brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-store" className="mb-1 block text-sm font-medium">
              Store
            </label>
            <select id="f-store" name="store" defaultValue={store} className="field py-2">
              <option value="">All stores</option>
              {facets.stores.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-min" className="mb-1 block text-sm font-medium">
              Min price (₹)
            </label>
            <input id="f-min" name="min" type="number" min={0} step={1} defaultValue={min ?? ""} className="field tabular py-2" />
          </div>
          <div>
            <label htmlFor="f-max" className="mb-1 block text-sm font-medium">
              Max price (₹)
            </label>
            <input id="f-max" name="max" type="number" min={0} step={1} defaultValue={max ?? ""} className="field tabular py-2" />
          </div>
          <div>
            <label htmlFor="f-sort" className="mb-1 block text-sm font-medium">
              Sort by
            </label>
            <select id="f-sort" name="sort" defaultValue={sort} className="field py-2">
              <option value="relevance">Best match</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-6">
            <button type="submit" className="btn btn-primary btn-small">
              Apply filters
            </button>
            {filtersActive ? (
              <Link href={`/search?q=${encodeURIComponent(q)}`} className="text-sm">
                Clear filters
              </Link>
            ) : null}
            <span className="ml-auto text-sm text-muted">
              {shown.length} of {outcome.products.length} products
            </span>
          </div>
        </form>
      ) : null}

      <div className="mt-6">
        {shown.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {shown.map(({ product }) => (
              <ProductCard key={product.id} product={product} storeKey={store || undefined} />
            ))}
          </div>
        ) : outcome.products.length > 0 ? (
          <EmptyState title="No products match these filters">
            <p>
              <Link href={`/search?q=${encodeURIComponent(q)}`}>Clear the filters</Link> to see all{" "}
              {outcome.products.length} results.
            </p>
          </EmptyState>
        ) : !outcome.notice ? (
          <EmptyState title="No products found">
            <p>Check the spelling, or try fewer words or a model number.</p>
          </EmptyState>
        ) : null}
      </div>
    </div>
  );
}

function SourceLine({ outcome }: { outcome: SearchOutcome }) {
  if (outcome.source === "live") return <>Prices fetched live just now.</>;
  if (outcome.source === "saved" && outcome.fetchedAt) {
    return <>Showing saved results, last fetched {timeAgo(outcome.fetchedAt)}.</>;
  }
  return null;
}

function SearchNotice({ outcome, q }: { outcome: SearchOutcome; q: string }) {
  const notice = outcome.notice!;
  const next = `/search?q=${encodeURIComponent(q)}`;
  switch (notice.kind) {
    case "login":
      return (
        <Notice tone="info" title="Sign in to fetch live prices">
          <p>
            {notice.message} Live lookups are limited, so they are reserved for signed-in members.{" "}
            <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link> or{" "}
            <Link href="/signup">create an account</Link>.
          </p>
        </Notice>
      );
    case "no_source":
      return (
        <Notice tone="caution" title="Live prices are not connected yet">
          <p>{notice.message} An administrator needs to add the data-source key (see SETUP.md).</p>
        </Notice>
      );
    case "user_limit":
    case "monthly_limit":
      return (
        <Notice tone="caution" title="Live lookup limit reached">
          <p>{notice.message}</p>
        </Notice>
      );
    case "source_error":
      return (
        <Notice tone="danger" title="Live prices could not be fetched">
          <p>{notice.message}</p>
        </Notice>
      );
    default:
      return (
        <Notice tone="info">
          <p>{notice.message}</p>
        </Notice>
      );
  }
}

function buildFacets(products: ProductWithListings[]) {
  const categories = new Set<Category>();
  const brands = new Set<string>();
  const stores = new Map<string, string>();
  for (const p of products) {
    categories.add(p.category);
    if (p.brand) brands.add(p.brand);
    for (const l of comparableListings(p.listings)) stores.set(l.store_key, l.store);
  }
  return {
    categories: Array.from(categories).sort((a, b) => CATEGORY_LABELS[a].localeCompare(CATEGORY_LABELS[b])),
    brands: Array.from(brands).sort((a, b) => a.localeCompare(b)),
    stores: Array.from(stores, ([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
