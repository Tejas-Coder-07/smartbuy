import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { categorise } from "@/lib/domain/categorise";
import { normaliseStore } from "@/lib/domain/stores";
import type { ListingRow, ProductRow, Variant, VariantMatch } from "@/lib/domain/types";
import { detectBrand, detectModel, parseVariant, titleMatchKey, variantKey } from "@/lib/domain/variants";
import type { ProviderSearchItem } from "@/lib/providers/types";

/** A repeat of the same price within this window is not stored again. */
const SAME_PRICE_WINDOW_MS = 6 * 60 * 60 * 1000;

export type ListingDraft = {
  product_id: string;
  store: string;
  store_key: string;
  variant: Variant;
  variant_key: string;
  variant_match: VariantMatch;
  title: string;
  url: string | null;
  price: number;
  mrp: number | null;
  shipping: string | null;
  detail: string | null;
};

export type SaveResult = { listings: number; observations: number };

function fullKey(d: { product_id: string; store_key: string; variant_key: string }): string {
  return `${d.product_id}|${d.store_key}|${d.variant_key}`;
}

function storeKeyOf(d: { product_id: string; store_key: string }): string {
  return `${d.product_id}|${d.store_key}`;
}

/**
 * Writes listings and, for each, a timestamped price observation.
 *
 * An existing listing is reused when the (product, store, variant) matches,
 * or when a store has exactly one stored listing and exactly one incoming
 * offer for the product, so that a store's history stays on one row even if
 * the offer title changes.
 */
export async function saveListings(
  db: SupabaseClient,
  provider: string,
  incoming: ListingDraft[],
  opts: { runId?: string | null } = {},
): Promise<SaveResult> {
  if (incoming.length === 0) return { listings: 0, observations: 0 };

  // Keep the lowest price when the same offer appears twice.
  const byKey = new Map<string, ListingDraft>();
  for (const d of incoming) {
    const k = fullKey(d);
    const prev = byKey.get(k);
    if (!prev || d.price < prev.price) byKey.set(k, d);
  }
  const drafts = Array.from(byKey.values());

  const productIds = Array.from(new Set(drafts.map((d) => d.product_id)));
  const { data: existingRows, error: readError } = await db.from("listings").select("*").in("product_id", productIds);
  if (readError) throw new Error(`Could not read listings: ${readError.message}`);
  const existing = (existingRows ?? []) as ListingRow[];

  const existingByFull = new Map(existing.map((l) => [fullKey(l), l]));
  const existingByStore = new Map<string, ListingRow[]>();
  for (const l of existing) {
    const k = storeKeyOf(l);
    existingByStore.set(k, [...(existingByStore.get(k) ?? []), l]);
  }
  const draftsPerStore = new Map<string, number>();
  for (const d of drafts) draftsPerStore.set(storeKeyOf(d), (draftsPerStore.get(storeKeyOf(d)) ?? 0) + 1);

  const now = new Date();
  const nowIso = now.toISOString();
  const rows: Record<string, unknown>[] = [];
  const observations: Record<string, unknown>[] = [];

  for (const d of drafts) {
    let match = existingByFull.get(fullKey(d));
    if (!match) {
      const sameStore = existingByStore.get(storeKeyOf(d)) ?? [];
      if (sameStore.length === 1 && draftsPerStore.get(storeKeyOf(d)) === 1) match = sameStore[0];
    }
    const id = match?.id ?? randomUUID();

    rows.push({
      id,
      product_id: d.product_id,
      store: d.store,
      store_key: d.store_key,
      variant_key: d.variant_key,
      variant: d.variant,
      variant_match: d.variant_match,
      title: d.title.slice(0, 500),
      url: d.url ?? match?.url ?? null,
      current_price: d.price,
      mrp: d.mrp,
      shipping: d.shipping,
      detail: d.detail,
      provider,
      last_observed_at: nowIso,
    });

    const previousPrice = match?.current_price === null || match?.current_price === undefined ? null : Number(match.current_price);
    const previousAt = match?.last_observed_at ? new Date(match.last_observed_at).getTime() : 0;
    const changed = previousPrice === null || previousPrice !== d.price;
    const old = now.getTime() - previousAt > SAME_PRICE_WINDOW_MS;
    if (changed || old) {
      observations.push({
        listing_id: id,
        product_id: d.product_id,
        price: d.price,
        mrp: d.mrp,
        currency: "INR",
        observed_at: nowIso,
        provider,
        run_id: opts.runId ?? null,
      });
    }
  }

  const { error: upsertError } = await db.from("listings").upsert(rows, { onConflict: "id" });
  if (upsertError) {
    // Most likely two requests saved the same new offer at the same moment.
    // Fall back to one row at a time so a single clash cannot lose the batch.
    for (const row of rows) {
      const { error } = await db.from("listings").upsert(row, { onConflict: "id" });
      if (!error) continue;
      const { data: clash } = await db
        .from("listings")
        .select("id")
        .eq("product_id", row.product_id as string)
        .eq("store_key", row.store_key as string)
        .eq("variant_key", row.variant_key as string)
        .maybeSingle();
      if (!clash) {
        observations.splice(0, observations.length, ...observations.filter((o) => o.listing_id !== row.id));
        continue;
      }
      const { id: _newId, ...changes } = row;
      void _newId;
      await db.from("listings").update(changes).eq("id", clash.id);
      for (const o of observations) if (o.listing_id === row.id) o.listing_id = clash.id;
    }
  }

  if (observations.length > 0) {
    const { error } = await db.from("price_observations").insert(observations);
    if (error) throw new Error(`Could not store price observations: ${error.message}`);
  }

  return { listings: rows.length, observations: observations.length };
}

type ProductIdentity = Pick<ProductRow, "id" | "match_key" | "title" | "brand" | "model" | "category" | "variant" | "image_url">;

/**
 * Stores search results: one product per distinct item, one listing for the
 * store whose price was quoted, and a price observation for each.
 * Returns product ids in the order the source ranked them.
 */
export async function ingestSearchItems(
  db: SupabaseClient,
  provider: string,
  items: ProviderSearchItem[],
): Promise<{ productIds: string[]; saved: SaveResult }> {
  if (items.length === 0) return { productIds: [], saved: { listings: 0, observations: 0 } };

  const keyed = items.map((item) => ({
    item,
    matchKey: item.providerProductId ? `gp:${item.providerProductId}` : `t:${titleMatchKey(item.title)}`,
  }));

  const firstByKey = new Map<string, ProviderSearchItem>();
  for (const k of keyed) if (!firstByKey.has(k.matchKey)) firstByKey.set(k.matchKey, k.item);
  const matchKeys = Array.from(firstByKey.keys());

  const { data: knownRows, error: knownError } = await db
    .from("products")
    .select("id, match_key, title, brand, model, category, variant, image_url")
    .in("match_key", matchKeys);
  if (knownError) throw new Error(`Could not read products: ${knownError.message}`);
  const known = new Map(((knownRows ?? []) as ProductIdentity[]).map((p) => [p.match_key, p]));

  const productRows = matchKeys.map((matchKey) => {
    const item = firstByKey.get(matchKey)!;
    const prior = known.get(matchKey);
    return {
      match_key: matchKey,
      // Identity fields stay as first recorded so a product does not drift.
      title: prior?.title ?? item.title.slice(0, 500),
      brand: prior ? prior.brand : detectBrand(item.title),
      model: prior ? prior.model : detectModel(item.title),
      category: prior?.category ?? categorise(item.title),
      variant: prior?.variant ?? parseVariant(item.title),
      image_url: item.imageUrl ?? prior?.image_url ?? null,
      provider,
      provider_product_id: item.providerProductId,
      provider_token: item.token,
      rating: item.rating,
      review_count: item.reviewCount !== null ? Math.round(item.reviewCount) : null,
    };
  });

  const { data: savedProducts, error: productError } = await db
    .from("products")
    .upsert(productRows, { onConflict: "match_key" })
    .select("id, match_key, variant");
  if (productError) throw new Error(`Could not store products: ${productError.message}`);

  const saved = new Map(
    ((savedProducts ?? []) as { id: string; match_key: string; variant: Variant }[]).map((p) => [p.match_key, p]),
  );

  const drafts: ListingDraft[] = [];
  for (const { item, matchKey } of keyed) {
    const product = saved.get(matchKey);
    if (!product) continue;
    const store = normaliseStore(item.store);
    const variant = product.variant ?? {};
    drafts.push({
      product_id: product.id,
      store: store.name,
      store_key: store.key,
      variant,
      variant_key: variantKey(variant),
      variant_match: Object.keys(variant).length > 0 ? "same" : "unknown",
      title: item.title,
      url: item.url,
      price: item.price,
      mrp: item.mrp,
      shipping: item.delivery,
      detail: null,
    });
  }

  const result = await saveListings(db, provider, drafts);
  const productIds = matchKeys.map((k) => saved.get(k)?.id).filter((id): id is string => Boolean(id));
  return { productIds, saved: result };
}
