import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settings } from "@/lib/config";
import type { ListingRow, ProductRow, ProductWithListings } from "@/lib/domain/types";

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normaliseListing(l: ListingRow): ListingRow {
  return { ...l, current_price: toNumber(l.current_price), mrp: toNumber(l.mrp), variant: l.variant ?? {} };
}

export function normaliseProduct<T extends ProductRow>(p: T): T {
  return { ...p, rating: toNumber(p.rating), variant: p.variant ?? {} };
}

/** Loads products with their listings, in the order of the ids given. */
export async function loadProducts(db: SupabaseClient, ids: string[]): Promise<ProductWithListings[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db.from("products").select("*, listings(*)").in("id", ids);
  if (error) throw new Error(`Could not load products: ${error.message}`);
  const byId = new Map(
    ((data ?? []) as ProductWithListings[]).map((p) => [
      p.id,
      { ...normaliseProduct(p), listings: (p.listings ?? []).map(normaliseListing) },
    ]),
  );
  return ids.map((id) => byId.get(id)).filter((p): p is ProductWithListings => Boolean(p));
}

export function isFresh(listing: Pick<ListingRow, "last_observed_at">, now = new Date()): boolean {
  if (!listing.last_observed_at) return false;
  const age = now.getTime() - new Date(listing.last_observed_at).getTime();
  return age <= settings.freshPriceHours() * 60 * 60 * 1000;
}

/** Listings that count as "this product": not a different variant, and priced. */
export function comparableListings(listings: ListingRow[]): ListingRow[] {
  return listings.filter((l) => l.variant_match !== "different" && l.current_price !== null && l.current_price > 0);
}

export type BestOffer = { listing: ListingRow; fresh: boolean };

/**
 * The lowest comparable price. Recently checked prices win over older ones;
 * an older price is only returned when nothing recent exists.
 */
export function bestOffer(listings: ListingRow[], now = new Date()): BestOffer | null {
  const candidates = comparableListings(listings);
  if (candidates.length === 0) return null;
  const byPrice = (a: ListingRow, b: ListingRow) => (a.current_price ?? 0) - (b.current_price ?? 0);
  const fresh = candidates.filter((l) => isFresh(l, now)).sort(byPrice);
  if (fresh.length > 0) return { listing: fresh[0], fresh: true };
  return { listing: [...candidates].sort(byPrice)[0], fresh: false };
}

export function storeCount(listings: ListingRow[]): number {
  return new Set(comparableListings(listings).map((l) => l.store_key)).size;
}
