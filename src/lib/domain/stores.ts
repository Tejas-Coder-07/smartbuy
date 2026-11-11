/**
 * Store names arrive in many spellings ("Amazon.in", "Amazon India",
 * "Flipkart.com"). Everything is mapped to a stable key so that the same
 * store is never counted twice.
 */
const KNOWN: { key: string; name: string; pattern: RegExp }[] = [
  { key: "amazon", name: "Amazon India", pattern: /\bamazon\b/ },
  { key: "flipkart", name: "Flipkart", pattern: /\bflipkart\b/ },
  { key: "myntra", name: "Myntra", pattern: /\bmyntra\b/ },
  { key: "ajio", name: "AJIO", pattern: /\bajio\b/ },
  { key: "croma", name: "Croma", pattern: /\bcroma\b/ },
  { key: "reliance-digital", name: "Reliance Digital", pattern: /\breliance\s*digital\b/ },
  { key: "tata-cliq", name: "Tata CLiQ", pattern: /\btata\s*cliq\b/ },
  { key: "vijay-sales", name: "Vijay Sales", pattern: /\bvijay\s*sales\b/ },
  { key: "jiomart", name: "JioMart", pattern: /\bjio\s*mart\b/ },
  { key: "nykaa", name: "Nykaa", pattern: /\bnykaa\b/ },
  { key: "meesho", name: "Meesho", pattern: /\bmeesho\b/ },
];

/** The six stores named in the project proposal. */
export const PROPOSAL_STORES = ["amazon", "flipkart", "myntra", "ajio", "croma", "reliance-digital"];

export function normaliseStore(raw: string): { key: string; name: string } {
  const cleaned = raw
    .replace(/^from\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = cleaned.toLowerCase();
  for (const s of KNOWN) {
    if (s.pattern.test(lower)) return { key: s.key, name: s.name };
  }
  const key = lower
    .replace(/\.(com|in|co\.in|net|org|store|shop)\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return { key: key || "unknown", name: cleaned || "Unknown store" };
}

export function storeFromQueryWord(word: string): { key: string; name: string } | null {
  const lower = word.toLowerCase();
  for (const s of KNOWN) {
    if (s.pattern.test(lower)) return { key: s.key, name: s.name };
  }
  return null;
}

export function isProposalStore(key: string): boolean {
  return PROPOSAL_STORES.includes(key);
}
