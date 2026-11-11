import Link from "next/link";
import { Suspense } from "react";
import { CardListSkeleton, ProductCard, SetupNotice } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/config";
import type { ProductWithListings } from "@/lib/domain/types";
import { normaliseListing, normaliseProduct } from "@/lib/services/catalogue";
import { createClient } from "@/lib/supabase/server";

const EXAMPLE_SEARCHES = [
  "iPhone 16 128GB",
  "Sony WH-1000XM5",
  "gaming laptop under 80000",
  "55 inch 4K TV under 40k",
  "Nike running shoes on Myntra",
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-14">
      <section className="pt-6 sm:pt-12">
        <h1 className="max-w-[16ch] text-5xl font-extrabold leading-[1.02] sm:text-7xl">
          Know the right price before you buy.
        </h1>
        <p className="mt-5 max-w-[58ch] text-lg text-muted">
          Search once to compare stores. SmartBuy records every price it checks, so you can tell a real price drop
          from a discount sticker, and get an alert when a product reaches the price you want.
        </p>

        <form action="/search" method="get" role="search" className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
          <label htmlFor="home-search" className="sr-only">
            Search products
          </label>
          <input
            id="home-search"
            name="q"
            type="search"
            required
            minLength={2}
            placeholder="Try “samsung phone under 20k”"
            className="field flex-1 px-4 py-3.5 text-lg"
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary px-6 py-3.5 text-lg">
            Search prices
          </button>
        </form>

        <ul className="mt-4 flex max-w-3xl flex-wrap gap-2" aria-label="Example searches">
          {EXAMPLE_SEARCHES.map((q) => (
            <li key={q}>
              <Link
                href={`/search?q=${encodeURIComponent(q)}`}
                className="inline-block rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink no-underline hover:border-ink"
              >
                {q}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="what" className="grid gap-x-10 gap-y-6 border-t border-line pt-8 md:grid-cols-3">
        <h2 id="what" className="sr-only">
          What SmartBuy does
        </h2>
        <div>
          <h3 className="text-xl font-bold">Compare stores side by side</h3>
          <p className="mt-2 text-muted">
            One search shows what each store charges for the same product. Different storage sizes, colours and sizes
            are kept apart, so you compare like with like.
          </p>
        </div>
        <div>
          <h3 className="text-xl font-bold">See the recorded price history</h3>
          <p className="mt-2 text-muted">
            Each product shows its highest, lowest and average recorded price with a graph. History starts the day
            SmartBuy first checks a product; nothing is back-filled or estimated.
          </p>
        </div>
        <div>
          <h3 className="text-xl font-bold">Get told at your price</h3>
          <p className="mt-2 text-muted">
            Save a product, set a target price, and SmartBuy emails you when a freshly checked price reaches it.
          </p>
        </div>
      </section>

      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-4 text-2xl font-bold">
          Recently checked prices
        </h2>
        <Suspense fallback={<CardListSkeleton count={4} />}>
          <RecentlyChecked />
        </Suspense>
      </section>
    </div>
  );
}

async function RecentlyChecked() {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*, listings(*)")
    .order("updated_at", { ascending: false })
    .limit(6);

  if (error) {
    return <p className="text-muted">Recently checked prices could not be loaded right now.</p>;
  }

  const products = ((data ?? []) as ProductWithListings[]).map((p) => ({
    ...normaliseProduct(p),
    listings: (p.listings ?? []).map(normaliseListing),
  }));

  if (products.length === 0) {
    return (
      <p className="max-w-[60ch] text-muted">
        No prices have been recorded yet. Search for a product above and it will appear here with its first recorded
        price.
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
