import { categorise } from "./categorise";
import { storeFromQueryWord } from "./stores";
import type { Category } from "./types";
import { detectBrand } from "./variants";

export type ParsedQuery = {
  /** The original text the user typed. */
  raw: string;
  /** Product words only: price and store phrases removed. */
  text: string;
  minPrice?: number;
  maxPrice?: number;
  storeKey?: string;
  storeName?: string;
  brand?: string;
  category: Category;
  sort?: "price_asc";
};

// A number followed by a unit ("300 litres", "8 gb", "55 inch") is a spec, not a price.
const UNIT = String.raw`(?!\s*(?:litres?|liters?|ltr|kg|gb|tb|inch(?:es)?|tons?|mah|hz|watts?|mm|cm|star|pieces?|pcs|mp|years?|months?)\b)`;
const NUM = String.raw`(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)${UNIT}\s*(k|lakhs?|lacs?|l)?(?![a-z0-9])`;

function toRupees(numText: string, suffix: string | undefined, hadCurrency: boolean): number | null {
  const n = Number(numText.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = (suffix ?? "").toLowerCase();
  if (s === "k") return Math.round(n * 1_000);
  if (s.startsWith("lakh") || s.startsWith("lac")) return Math.round(n * 100_000);
  if (s === "l") return n < 100 ? Math.round(n * 100_000) : null;
  // A bare small number ("under 20") is more likely a size or count than a price.
  if (n < 50 && !hadCurrency) return null;
  return Math.round(n);
}

function hadCurrency(match: string): boolean {
  return /₹|rs\.?|inr/i.test(match);
}

const STORE_WORDS =
  "amazon|flipkart|myntra|ajio|croma|reliance\\s*digital|tata\\s*cliq|vijay\\s*sales|jio\\s*mart|nykaa|meesho";

/**
 * Turns a natural-language shopping query into structured search input.
 *
 *   "samsung phone under 20k on flipkart"
 *     -> text "samsung phone", maxPrice 20000, store flipkart
 */
export function parseQuery(input: string): ParsedQuery {
  const raw = input.replace(/\s+/g, " ").trim().slice(0, 200);
  let work = ` ${raw.toLowerCase()} `;
  let minPrice: number | undefined;
  let maxPrice: number | undefined;
  let sort: ParsedQuery["sort"];

  const between = new RegExp(String.raw`\b(?:between|from)\s+${NUM}\s*(?:and|to|-|–)\s*${NUM}`, "i").exec(work);
  if (between) {
    const a = toRupees(between[1], between[2] ?? between[4], hadCurrency(between[0]) || Boolean(between[4]));
    const b = toRupees(between[3], between[4], hadCurrency(between[0]));
    if (a && b) {
      minPrice = Math.min(a, b);
      maxPrice = Math.max(a, b);
      work = work.replace(between[0], " ");
    }
  }

  if (minPrice === undefined && maxPrice === undefined) {
    const max = new RegExp(
      String.raw`(?:\b(?:under|below|less than|lesser than|upto|up to|within|max(?:imum)?|not more than|cheaper than|budget(?: of)?)|<)\s*${NUM}`,
      "i",
    ).exec(work);
    if (max) {
      const v = toRupees(max[1], max[2], hadCurrency(max[0]));
      if (v) {
        maxPrice = v;
        work = work.replace(max[0], " ");
      }
    }
    const min = new RegExp(
      String.raw`(?:\b(?:above|over|more than|min(?:imum)?|at least|starting(?: from| at)?)|>)\s*${NUM}`,
      "i",
    ).exec(work);
    if (min) {
      const v = toRupees(min[1], min[2], hadCurrency(min[0]));
      if (v) {
        minPrice = v;
        work = work.replace(min[0], " ");
      }
    }
  }

  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }

  let storeKey: string | undefined;
  let storeName: string | undefined;
  const store = new RegExp(String.raw`\b(?:on|from|at|in)\s+(${STORE_WORDS})\b(?:\.in|\.com)?`, "i").exec(work);
  if (store) {
    const s = storeFromQueryWord(store[1]);
    if (s) {
      storeKey = s.key;
      storeName = s.name;
      work = work.replace(store[0], " ");
    }
  }

  if (/\b(cheapest|lowest price|lowest priced|least expensive)\b/.test(work)) {
    sort = "price_asc";
  }

  work = work
    .replace(/\b(show me|i want to buy|i want|i need|looking for|look for|find me|find|search for|buy|price of|prices of|best price for|best deal on|deals on|cheapest|lowest priced|lowest price|least expensive|please)\b/g, " ")
    .replace(/\b(rupees|rs\.?|inr)\b|₹/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the|some)\s+/, "")
    .replace(/[\s,.-]+$/, "");

  const text = work.length >= 2 ? work : raw.toLowerCase();
  const brand = detectBrand(text, { fallbackToFirstWord: false }) ?? undefined;

  return {
    raw,
    text,
    ...(minPrice !== undefined ? { minPrice } : {}),
    ...(maxPrice !== undefined ? { maxPrice } : {}),
    ...(storeKey ? { storeKey, storeName } : {}),
    ...(brand ? { brand } : {}),
    category: categorise(text),
    ...(sort ? { sort } : {}),
  };
}

/** Cache key for a parsed query: same words in any order hit the same entry. */
export function queryCacheKey(provider: string, q: ParsedQuery): string {
  return [provider, q.text.replace(/\s+/g, " ").trim(), q.minPrice ?? "", q.maxPrice ?? ""].join("|");
}
