import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseStore } from "@/lib/domain/stores";
import type { ProductRow } from "@/lib/domain/types";
import { compareVariants, parseVariant, variantKey } from "@/lib/domain/variants";
import { getProvider } from "@/lib/providers";
import { saveListings, type ListingDraft, type SaveResult } from "./ingest";
import { trackedCall } from "./usage";

export type RefreshResult = SaveResult & { stores: number };

/**
 * Asks the data source for every store's current offer on one product and
 * records the prices. Uses one data-source call.
 */
export async function refreshOffers(
  db: SupabaseClient,
  product: Pick<ProductRow, "id" | "title" | "variant" | "provider_product_id" | "provider_token">,
  ctx: { userId?: string | null; runId?: string | null } = {},
): Promise<RefreshResult> {
  const provider = getProvider();

  const result = await trackedCall(
    db,
    { provider: provider.id, kind: "offers", userId: ctx.userId, runId: ctx.runId },
    () => provider.offers({ providerProductId: product.provider_product_id, token: product.provider_token }),
  );

  const productVariant = product.variant ?? {};
  const drafts: ListingDraft[] = result.offers.map((offer) => {
    const store = normaliseStore(offer.store);
    const offerVariant = parseVariant(offer.title || product.title);
    return {
      product_id: product.id,
      store: store.name,
      store_key: store.key,
      variant: offerVariant,
      variant_key: variantKey(offerVariant),
      variant_match: compareVariants(productVariant, offerVariant),
      title: offer.title || product.title,
      url: offer.url,
      price: offer.price,
      mrp: offer.mrp,
      shipping: offer.shipping,
      detail: offer.detail,
    };
  });

  const saved = await saveListings(db, provider.id, drafts, { runId: ctx.runId });

  const update: Record<string, unknown> = { offers_refreshed_at: new Date().toISOString() };
  if (result.token) update.provider_token = result.token;
  const { error } = await db.from("products").update(update).eq("id", product.id);
  if (error) console.error("[smartbuy] could not mark product refreshed:", error.message);

  return { ...saved, stores: new Set(drafts.map((d) => d.store_key)).size };
}
