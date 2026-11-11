import "server-only";
import { isServerConfigured, settings } from "@/lib/config";
import { parseQuery, queryCacheKey, type ParsedQuery } from "@/lib/domain/parse-query";
import type { ProductWithListings } from "@/lib/domain/types";
import { getProvider, ProviderError } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProducts } from "./catalogue";
import { ingestSearchItems } from "./ingest";
import { checkLiveBudget, trackedCall } from "./usage";

export type SearchNotice =
  | "setup"
  | "no_source"
  | "login"
  | "user_limit"
  | "monthly_limit"
  | "source_error"
  | "too_short";

export type SearchOutcome = {
  parsed: ParsedQuery;
  products: ProductWithListings[];
  /** Where the results came from. */
  source: "live" | "saved" | "none";
  /** When the data source was last asked for this query. */
  fetchedAt: string | null;
  notice?: { kind: SearchNotice; message: string };
};

const LOG_DEDUPE_MS = 10 * 60 * 1000;

/**
 * Text search across supported stores.
 *
 * Results are reused for a few hours so that repeat searches do not spend
 * the data source's allowance. A live lookup needs a signed-in user.
 */
export async function runSearch(rawQuery: string, userId: string | null): Promise<SearchOutcome> {
  const parsed = parseQuery(rawQuery);
  const empty = (kind: SearchNotice, message: string): SearchOutcome => ({
    parsed,
    products: [],
    source: "none",
    fetchedAt: null,
    notice: { kind, message },
  });

  if (parsed.text.length < 2) {
    return empty("too_short", "Type a product name, model number or description to search.");
  }
  if (!isServerConfigured()) {
    return empty("setup", "SmartBuy is not connected to its database yet.");
  }

  const db = createAdminClient();
  const provider = getProvider();
  const key = queryCacheKey(provider.id, parsed);

  const { data: cached, error: cacheError } = await db
    .from("search_cache")
    .select("product_ids, fetched_at")
    .eq("query_key", key)
    .maybeSingle();
  if (cacheError) throw new Error(`Could not read the search cache: ${cacheError.message}`);

  const cacheAgeMs = cached ? Date.now() - new Date(cached.fetched_at).getTime() : Infinity;
  const cacheIsCurrent = cacheAgeMs <= settings.searchCacheHours() * 60 * 60 * 1000;

  const fromSaved = async (notice?: SearchOutcome["notice"]): Promise<SearchOutcome> => {
    const products = cached ? await loadProducts(db, cached.product_ids as string[]) : [];
    await logSearch(db, userId, parsed, products.length, true);
    return {
      parsed,
      products,
      source: cached ? "saved" : "none",
      fetchedAt: cached?.fetched_at ?? null,
      notice,
    };
  };

  if (cached && cacheIsCurrent) return fromSaved();

  if (!provider.isConfigured()) {
    return fromSaved({
      kind: "no_source",
      message: "No product-data source is connected yet, so live prices cannot be fetched.",
    });
  }
  if (!userId) {
    return fromSaved({
      kind: "login",
      message: cached
        ? "These are saved results. Sign in to fetch the latest prices."
        : "Sign in to search live prices for this product.",
    });
  }

  const budget = await checkLiveBudget(db, userId);
  if (!budget.ok) return fromSaved({ kind: budget.reason, message: budget.message });

  try {
    const items = await trackedCall(db, { provider: provider.id, kind: "search", userId }, () =>
      provider.search({ text: parsed.text, minPrice: parsed.minPrice, maxPrice: parsed.maxPrice }),
    );
    const { productIds } = await ingestSearchItems(db, provider.id, items);
    const fetchedAt = new Date().toISOString();
    const { error: saveError } = await db
      .from("search_cache")
      .upsert({ query_key: key, provider: provider.id, product_ids: productIds, fetched_at: fetchedAt });
    if (saveError) console.error("[smartbuy] could not save search cache:", saveError.message);

    const products = await loadProducts(db, productIds);
    await logSearch(db, userId, parsed, products.length, false);
    return { parsed, products, source: "live", fetchedAt };
  } catch (err) {
    console.error("[smartbuy] live search failed:", err);
    const message =
      err instanceof ProviderError
        ? err.message
        : "Something went wrong while fetching live prices. Please try again.";
    return fromSaved({ kind: "source_error", message });
  }
}

async function logSearch(
  db: ReturnType<typeof createAdminClient>,
  userId: string | null,
  parsed: ParsedQuery,
  resultCount: number,
  fromCache: boolean,
) {
  try {
    // Changing a filter re-renders the page; do not log the same search twice.
    const since = new Date(Date.now() - LOG_DEDUPE_MS).toISOString();
    let recent = db.from("searches").select("id", { count: "exact", head: true }).eq("query", parsed.raw).gte("created_at", since);
    recent = userId ? recent.eq("user_id", userId) : recent.is("user_id", null);
    const { count } = await recent;
    if ((count ?? 0) > 0) return;

    await db.from("searches").insert({
      user_id: userId,
      query: parsed.raw,
      parsed: {
        text: parsed.text,
        minPrice: parsed.minPrice ?? null,
        maxPrice: parsed.maxPrice ?? null,
        store: parsed.storeKey ?? null,
        brand: parsed.brand ?? null,
        category: parsed.category,
      },
      result_count: resultCount,
      from_cache: fromCache,
    });
  } catch (err) {
    console.error("[smartbuy] could not log search:", err);
  }
}
