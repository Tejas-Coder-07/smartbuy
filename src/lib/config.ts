/**
 * Central place for every setting SmartBuy reads from the environment.
 * Nothing here is a secret that reaches the browser: only the two
 * NEXT_PUBLIC_ values are exposed, and both are safe to publish.
 */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
}

export function supabasePublishableKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || undefined;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabasePublishableKey());
}

export function supabaseSecretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY || undefined;
}

export function isServerConfigured(): boolean {
  return isSupabaseConfigured() && Boolean(supabaseSecretKey());
}

export function serpApiKey(): string | undefined {
  return process.env.SERPAPI_API_KEY || undefined;
}

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const settings = {
  /** How long a search result set is reused before asking the data source again. */
  searchCacheHours: () => int("SEARCH_CACHE_HOURS", 12),
  /** How long a product's store offers are reused before asking again. */
  offersCacheHours: () => int("OFFERS_CACHE_HOURS", 12),
  /** Data-source calls allowed per calendar month (SerpApi free plan: 250). */
  providerMonthlyLimit: () => int("PROVIDER_MONTHLY_LIMIT", 250),
  /** Live data-source calls one signed-in user may trigger in 24 hours. */
  userDailyLiveLimit: () => int("USER_DAILY_LIVE_LIMIT", 15),
  /** Tracked products refreshed by each scheduled collection run. */
  collectMaxProducts: () => int("COLLECT_MAX_PRODUCTS", 6),
  /** A listing price older than this is not used for alerts or "best price". */
  freshPriceHours: () => int("FRESH_PRICE_HOURS", 36),
};

export function gmailConfig(): { user: string; pass: string; fromName: string } | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return { user, pass: pass.replace(/\s+/g, ""), fromName: process.env.EMAIL_FROM_NAME || "Tejas" };
}

export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET || undefined;
}
