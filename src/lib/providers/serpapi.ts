import { serpApiKey } from "@/lib/config";
import {
  ProviderError,
  type ProductProvider,
  type ProviderOffer,
  type ProviderOffersResult,
  type ProviderProductRef,
  type ProviderSearchItem,
  type ProviderSearchQuery,
} from "./types";

/**
 * SerpApi adapter (https://serpapi.com).
 *
 * - search:  Google Shopping results for India (engine=google_shopping)
 * - offers:  every store selling one product (engine=google_product, or
 *            engine=google_immersive_product when only a page token is known)
 *
 * Each successful call uses one search credit on the SerpApi account.
 */

const ENDPOINT = "https://serpapi.com/search.json";
const TIMEOUT_MS = 25_000;
const COUNTRY = { gl: "in", hl: "en", google_domain: "google.co.in" };

type Json = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function httpUrl(v: unknown): string | null {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
}

/** Prices must be in rupees. Anything quoted in another currency is dropped. */
function isRupeePrice(display: unknown): boolean {
  const s = str(display);
  if (!s) return true; // no display string: trust the numeric field
  if (/₹|rs\.?|inr/i.test(s)) return true;
  return !/[$€£¥]|usd|eur|gbp/i.test(s);
}

export function mapSearchResponse(body: Json): ProviderSearchItem[] {
  const groups: unknown[] = [];
  if (Array.isArray(body.shopping_results)) groups.push(...body.shopping_results);
  if (Array.isArray(body.categorized_shopping_results)) {
    for (const cat of body.categorized_shopping_results as Json[]) {
      if (Array.isArray(cat?.shopping_results)) groups.push(...(cat.shopping_results as unknown[]));
    }
  }

  const items: ProviderSearchItem[] = [];
  for (const raw of groups) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Json;
    const title = str(r.title);
    const store = str(r.source);
    const price = num(r.extracted_price);
    if (!title || !store || price === null || price <= 0) continue;
    if (!isRupeePrice(r.price)) continue;
    // Used and refurbished items would distort a new-product price history.
    if (str(r.second_hand_condition)) continue;

    const mrp = num(r.extracted_old_price);
    items.push({
      providerProductId: str(r.product_id),
      token: str(r.immersive_product_page_token),
      title,
      store,
      price,
      mrp: mrp !== null && mrp > price ? mrp : null,
      imageUrl: httpUrl(r.thumbnail) ?? httpUrl(r.serpapi_thumbnail),
      url: httpUrl(r.product_link) ?? httpUrl(r.link),
      rating: num(r.rating),
      reviewCount: num(r.reviews),
      delivery: str(r.delivery),
    });
  }
  return items;
}

export function mapOffersResponse(body: Json): ProviderOffersResult {
  const product = (body.product_results ?? {}) as Json;
  const stores = Array.isArray(product.stores) ? (product.stores as Json[]) : [];
  const fallbackTitle = str(product.title) ?? "";

  const offers: ProviderOffer[] = [];
  for (const s of stores) {
    if (!s || typeof s !== "object") continue;
    const store = str(s.name);
    const price = num(s.extracted_price);
    if (!store || price === null || price <= 0) continue;
    if (!isRupeePrice(s.price)) continue;

    const mrp = num(s.extracted_original_price);
    const details = Array.isArray(s.details_and_offers)
      ? (s.details_and_offers as unknown[]).map(str).filter((d): d is string => d !== null)
      : [];
    const detail = [str(s.tag), ...details].filter(Boolean).join("; ").slice(0, 300);

    offers.push({
      store,
      title: str(s.title) ?? fallbackTitle,
      url: httpUrl(s.link),
      price,
      mrp: mrp !== null && mrp > price ? mrp : null,
      shipping: str(s.shipping),
      detail: detail || null,
    });
  }

  return { offers, token: str(product.page_token) };
}

async function call(params: Record<string, string>): Promise<Json> {
  const key = serpApiKey();
  if (!key) {
    throw new ProviderError("not_configured", "SERPAPI_API_KEY is not set.");
  }

  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries({ ...params, api_key: key })) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new ProviderError(
      timedOut ? "timeout" : "http",
      timedOut ? "The data source took too long to respond." : "Could not reach the data source.",
    );
  }

  let body: Json;
  try {
    body = (await res.json()) as Json;
  } catch {
    throw new ProviderError("invalid_response", `The data source returned an unreadable response (HTTP ${res.status}).`, res.status);
  }

  const apiError = str(body.error);
  if (apiError && /hasn't returned any results|no results/i.test(apiError)) {
    return {}; // a valid "nothing found" answer
  }
  if (!res.ok || apiError) {
    const message = apiError ?? `HTTP ${res.status}`;
    if (res.status === 401 || /invalid api key/i.test(message)) {
      throw new ProviderError("auth", "The SerpApi key was rejected. Check SERPAPI_API_KEY.", res.status);
    }
    if (res.status === 429 || /run out of searches|rate limit|too many/i.test(message)) {
      throw new ProviderError("quota", "The data source's search allowance is used up for now.", res.status);
    }
    throw new ProviderError("http", `The data source returned an error: ${message}`, res.status);
  }

  return body;
}

export const serpApiProvider: ProductProvider = {
  id: "serpapi",
  name: "SerpApi: Google Shopping (India)",

  isConfigured() {
    return Boolean(serpApiKey());
  },

  async search(query: ProviderSearchQuery): Promise<ProviderSearchItem[]> {
    const params: Record<string, string> = { engine: "google_shopping", q: query.text, ...COUNTRY };
    if (query.minPrice !== undefined) params.min_price = String(query.minPrice);
    if (query.maxPrice !== undefined) params.max_price = String(query.maxPrice);
    return mapSearchResponse(await call(params));
  },

  async offers(ref: ProviderProductRef): Promise<ProviderOffersResult> {
    if (ref.providerProductId) {
      const body = await call({
        engine: "google_product",
        product_id: ref.providerProductId,
        gl: COUNTRY.gl,
        hl: COUNTRY.hl,
      });
      return mapOffersResponse(body);
    }
    if (ref.token) {
      const body = await call({
        engine: "google_immersive_product",
        page_token: ref.token,
        more_stores: "true",
      });
      return mapOffersResponse(body);
    }
    throw new ProviderError("invalid_response", "This product has no identifier the data source can look up.");
  },
};
