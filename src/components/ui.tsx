import Link from "next/link";
import type { ReactNode } from "react";
import { CATEGORY_LABELS } from "@/lib/domain/categorise";
import { formatINR, timeAgo } from "@/lib/domain/format";
import type { ProductWithListings } from "@/lib/domain/types";
import { variantLabel } from "@/lib/domain/variants";
import { bestOffer, storeCount } from "@/lib/services/catalogue";

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "caution" | "danger" | "good";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: "border-accent/30 bg-accent-soft text-ink",
    caution: "border-caution/30 bg-caution-soft text-ink",
    danger: "border-danger/30 bg-danger-soft text-ink",
    good: "border-good/30 bg-good-soft text-ink",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-[0.9375rem] ${tones[tone]}`} role={tone === "danger" ? "alert" : "status"}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}

export function SetupNotice() {
  return (
    <Notice tone="caution" title="SmartBuy is not connected yet">
      <p>
        The app is running, but it has no database or product-data source configured. Follow the steps in{" "}
        <code className="rounded bg-surface px-1 py-0.5 text-sm">SETUP.md</code> to add the Supabase and data-source
        keys, then reload this page.
      </p>
    </Notice>
  );
}

export function ProductImage({ src, alt, size }: { src: string | null; alt: string; size: "card" | "detail" }) {
  const box = size === "card" ? "h-24 w-24" : "h-56 w-56 sm:h-64 sm:w-64";
  if (!src) {
    return (
      <div className={`${box} flex shrink-0 items-center justify-center rounded-lg border border-line bg-paper text-sm text-muted`}>
        No image
      </div>
    );
  }
  return (
    // Images come from many store CDNs, so the plain img element is used on purpose.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={`${box} shrink-0 rounded-lg border border-line bg-white object-contain p-1`}
    />
  );
}

export function ProductCard({ product, storeKey }: { product: ProductWithListings; storeKey?: string }) {
  const listings = storeKey ? product.listings.filter((l) => l.store_key === storeKey) : product.listings;
  const best = bestOffer(listings);
  const stores = storeCount(product.listings);
  const variant = variantLabel(product.variant);

  return (
    <article className="panel flex gap-4 p-4">
      <ProductImage src={product.image_url} alt="" size="card" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-[1.0625rem] font-semibold leading-snug">
          <Link href={`/product/${product.id}`} className="text-ink no-underline hover:underline">
            {product.title}
          </Link>
        </h3>
        <p className="text-sm text-muted">
          {[product.brand, CATEGORY_LABELS[product.category], variant].filter(Boolean).join(", ")}
        </p>
        {best && best.listing.current_price !== null ? (
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="price-tag text-lg">{formatINR(best.listing.current_price)}</span>
            <span className="text-sm text-muted">
              at {best.listing.store}, checked {timeAgo(best.listing.last_observed_at)}
            </span>
          </div>
        ) : (
          <p className="mt-auto text-sm text-muted">No price recorded yet</p>
        )}
        <p className="text-sm text-muted">
          {stores > 1 ? `${stores} stores compared` : "One store so far. Open it to compare all stores."}
        </p>
      </div>
    </article>
  );
}

export function PageHeading({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
      {lead ? <p className="mt-2 max-w-[68ch] text-muted">{lead}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong px-5 py-8">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children ? <div className="mt-1 max-w-[62ch] text-muted">{children}</div> : null}
    </div>
  );
}

export function CardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel flex gap-4 p-4">
          <div className="skeleton h-24 w-24 shrink-0" />
          <div className="flex flex-1 flex-col gap-3">
            <div className="skeleton h-5 w-4/5" />
            <div className="skeleton h-4 w-2/5" />
            <div className="skeleton h-8 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}
