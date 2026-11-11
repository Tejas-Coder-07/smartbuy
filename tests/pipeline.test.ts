import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-db";

/**
 * End-to-end test of the price pipeline with the network replaced:
 *  - the database is an in-memory stand-in (tests/helpers/fake-db.ts)
 *  - SerpApi responses are test fixtures in SerpApi's documented shape
 *  - Gmail is replaced by a recorder
 * The fixture products exist only inside this test file.
 */

const db = new FakeDb();
const sentMail: { to: string; subject: string; from: unknown }[] = [];

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: { to: string; subject: string; from: unknown }) => {
        sentMail.push(m);
      },
    }),
  },
}));

const USER = "00000000-0000-0000-0000-00000000000a";

const SHOPPING_RESPONSE = {
  shopping_results: [
    {
      position: 1,
      title: "Apple iPhone 16 128GB Black",
      product_id: "111",
      product_link: "https://www.google.com/shopping/product/111?gl=in",
      immersive_product_page_token: "tok-111",
      source: "Flipkart",
      price: "₹72,999",
      extracted_price: 72999,
      old_price: "₹79,900",
      extracted_old_price: 79900,
      rating: 4.6,
      reviews: 12840,
      thumbnail: "https://encrypted-tbn0.gstatic.com/shopping?q=tbn:test111",
      delivery: "Free delivery",
    },
    {
      position: 2,
      title: "Apple iPhone 16 256GB Black",
      product_id: "222",
      source: "Amazon.in",
      price: "₹82,900",
      extracted_price: 82900,
      thumbnail: "data:image/webp;base64,AAAA",
      serpapi_thumbnail: "https://serpapi.com/searches/x/images/y.webp",
    },
    {
      position: 3,
      title: "Apple iPhone 16 128GB Black",
      product_id: "111",
      source: "Croma",
      price: "₹73,490",
      extracted_price: 73490,
    },
    { position: 4, title: "Apple iPhone 16 128GB (Refurbished)", product_id: "333", source: "Cashify", price: "₹55,000", extracted_price: 55000, second_hand_condition: "refurbished" },
    { position: 5, title: "Apple iPhone 16 128GB", product_id: "444", source: "eBay", price: "$799.00", extracted_price: 799 },
    { position: 6, title: "No price item", product_id: "555", source: "Somewhere" },
  ],
};

function offersResponse(flipkartPrice: number) {
  return {
    product_results: {
      title: "Apple iPhone 16",
      stores: [
        { name: "Flipkart", title: "Apple iPhone 16 (Black, 128 GB)", link: "https://www.flipkart.com/p/abc", price: `₹${flipkartPrice}`, extracted_price: flipkartPrice, shipping: "Free delivery" },
        { name: "Amazon.in", title: "Apple iPhone 16 128 GB: Black", link: "https://www.amazon.in/dp/xyz", price: "₹71,999", extracted_price: 71999, original_price: "₹79,900", extracted_original_price: 79900, details_and_offers: ["Bank offer"] },
        { name: "Reliance Digital", title: "Apple iPhone 16 256GB Black", link: "https://www.reliancedigital.in/p/1", price: "₹81,000", extracted_price: 81000 },
        { name: "Croma", title: "Apple iPhone 16", link: "https://www.croma.com/p/2", price: "₹73,490", extracted_price: 73490 },
      ],
    },
  };
}

let fetchCalls: URL[] = [];
let flipkartPrice = 70999;
let failOffers = false;

beforeEach(() => {
  db.tables = {};
  sentMail.length = 0;
  fetchCalls = [];
  flipkartPrice = 70999;
  failOffers = false;

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.SERPAPI_API_KEY = "serp-test";
  process.env.GMAIL_USER = "sender@example.com";
  process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
  delete process.env.PROVIDER_MONTHLY_LIMIT;
  delete process.env.COLLECT_MAX_PRODUCTS;

  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = new URL(String(input));
    fetchCalls.push(url);
    const engine = url.searchParams.get("engine");
    if (engine === "google_shopping") return Response.json(SHOPPING_RESPONSE);
    if (failOffers) return Response.json({ error: "Your account has run out of searches." }, { status: 429 });
    return Response.json(offersResponse(flipkartPrice));
  });

  db.table("profiles").push({ id: USER, email: "member@example.com" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function search(q: string, user: string | null = USER) {
  const { runSearch } = await import("@/lib/services/search");
  return runSearch(q, user);
}

async function refresh(productId: string) {
  const { refreshOffers } = await import("@/lib/services/offers");
  const product = db.table("products").find((p) => p.id === productId)!;
  return refreshOffers(db as never, product as never, { userId: USER });
}

function productByKey(key: string) {
  return db.table("products").find((p) => p.match_key === key)!;
}

describe("search", () => {
  it("fetches live results for India, stores them and records prices", async () => {
    const out = await search("iphone 16 128gb under 80000");

    expect(out.source).toBe("live");
    expect(fetchCalls).toHaveLength(1);
    const p = fetchCalls[0].searchParams;
    expect(p.get("engine")).toBe("google_shopping");
    expect(p.get("q")).toBe("iphone 16 128gb");
    expect(p.get("gl")).toBe("in");
    expect(p.get("max_price")).toBe("80000");
    expect(p.get("api_key")).toBe("serp-test");

    // Two real products; the refurbished, dollar-priced and unpriced items are dropped.
    expect(out.products.map((x) => x.title)).toEqual(["Apple iPhone 16 128GB Black", "Apple iPhone 16 256GB Black"]);
    const first = out.products[0];
    expect(first.variant).toEqual({ storage: "128GB", colour: "black" });
    expect(first.brand).toBe("Apple");
    expect(first.category).toBe("mobiles");
    expect(first.listings.map((l) => l.store).sort()).toEqual(["Croma", "Flipkart"]);
    expect(out.products[1].image_url).toBe("https://serpapi.com/searches/x/images/y.webp");
    expect(out.products[1].listings[0].store).toBe("Amazon India");

    expect(db.table("price_observations")).toHaveLength(3);
    expect(db.table("provider_calls")).toMatchObject([{ kind: "search", ok: true, user_id: USER }]);
    expect(db.table("searches")).toMatchObject([{ query: "iphone 16 128gb under 80000", result_count: 2, from_cache: false }]);
  });

  it("reuses saved results instead of spending another lookup", async () => {
    await search("iphone 16 128gb");
    const again = await search("iPhone 16  128GB");
    expect(again.source).toBe("saved");
    expect(again.products).toHaveLength(2);
    expect(fetchCalls).toHaveLength(1);
    expect(db.table("price_observations")).toHaveLength(3);
  });

  it("asks visitors to sign in before a live lookup", async () => {
    const out = await search("iphone 16 128gb", null);
    expect(out.notice?.kind).toBe("login");
    expect(out.products).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });

  it("stops live lookups once the monthly allowance is used", async () => {
    process.env.PROVIDER_MONTHLY_LIMIT = "1";
    await search("iphone 16 128gb");
    const out = await search("sony headphones");
    expect(out.notice?.kind).toBe("monthly_limit");
    expect(fetchCalls).toHaveLength(1);
  });

  it("limits how many live lookups one member can trigger in a day", async () => {
    process.env.USER_DAILY_LIVE_LIMIT = "1";
    await search("iphone 16 128gb");
    const out = await search("sony headphones");
    expect(out.notice?.kind).toBe("user_limit");
    delete process.env.USER_DAILY_LIVE_LIMIT;
  });
});

describe("store comparison", () => {
  it("adds every store's offer and keeps other variants apart", async () => {
    await search("iphone 16 128gb");
    const product = productByKey("gp:111");
    const result = await refresh(product.id as string);

    expect(fetchCalls[1].searchParams.get("engine")).toBe("google_product");
    expect(fetchCalls[1].searchParams.get("product_id")).toBe("111");
    expect(result.stores).toBe(4);

    const listings = db.table("listings").filter((l) => l.product_id === product.id);
    const byStore = Object.fromEntries(listings.map((l) => [l.store_key, l]));
    expect(Object.keys(byStore).sort()).toEqual(["amazon", "croma", "flipkart", "reliance-digital"]);

    // Same store, same row: the search listing was updated, not duplicated.
    expect(byStore.flipkart.current_price).toBe(70999);
    expect(byStore.flipkart.url).toBe("https://www.flipkart.com/p/abc");
    expect(byStore.flipkart.variant_match).toBe("same");
    expect(byStore.amazon.variant_match).toBe("same");
    expect(byStore.amazon.mrp).toBe(79900);
    expect(byStore["reliance-digital"].variant_match).toBe("different");
    expect(byStore.croma.variant_match).toBe("unknown");

    const { bestOffer } = await import("@/lib/services/catalogue");
    expect(bestOffer(listings as never)?.listing.store).toBe("Flipkart");

    // Flipkart: 72,999 from search, then 70,999. Croma: unchanged price within 6 hours, so one row.
    const history = db.table("price_observations").filter((o) => o.product_id === product.id);
    expect(history.filter((o) => o.listing_id === byStore.flipkart.id).map((o) => o.price)).toEqual([72999, 70999]);
    expect(history.filter((o) => o.listing_id === byStore.croma.id)).toHaveLength(1);
    expect(product.offers_refreshed_at).not.toBeNull();
  });

  it("does not store the same price twice within six hours, but does after", async () => {
    await search("iphone 16 128gb");
    const product = productByKey("gp:111");
    await refresh(product.id as string);
    const before = db.table("price_observations").length;

    await refresh(product.id as string);
    expect(db.table("price_observations")).toHaveLength(before);

    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    db.table("listings").forEach((l) => (l.last_observed_at = sevenHoursAgo));
    await refresh(product.id as string);
    expect(db.table("price_observations")).toHaveLength(before + 4);
  });

  it("records a failed lookup and surfaces a clear error", async () => {
    await search("iphone 16 128gb");
    failOffers = true;
    await expect(refresh(productByKey("gp:111").id as string)).rejects.toThrow(/allowance is used up/);
    expect(db.table("provider_calls").at(-1)).toMatchObject({ kind: "offers", ok: false, status_code: 429 });
  });
});

describe("price alerts", () => {
  async function setUp(target: number, listingStore?: string) {
    await search("iphone 16 128gb");
    const product = productByKey("gp:111");
    await refresh(product.id as string);
    const listing = listingStore
      ? db.table("listings").find((l) => l.product_id === product.id && l.store_key === listingStore)
      : null;
    db.table("price_alerts").push({ id: "alert-1", user_id: USER, product_id: product.id, listing_id: listing?.id ?? null, target_price: target, status: "active" });
    return product;
  }

  it("triggers once when a fresh price reaches the target, in-app and by email", async () => {
    const product = await setUp(71000);
    const { evaluateAlerts } = await import("@/lib/services/alerts");

    expect(await evaluateAlerts(db as never, [product.id as string])).toBe(1);
    const alert = db.table("price_alerts")[0];
    expect(alert).toMatchObject({ status: "triggered", triggered_price: 70999, triggered_store: "Flipkart" });

    const note = db.table("notifications")[0];
    expect(note.title).toBe("Apple iPhone 16 128GB Black is now ₹70,999");
    expect(note.email_status).toBe("sent");
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toBe("member@example.com");
    expect(sentMail[0].from).toEqual({ name: "Tejas", address: "sender@example.com" });

    // A second evaluation does not notify again.
    expect(await evaluateAlerts(db as never, [product.id as string])).toBe(0);
    expect(sentMail).toHaveLength(1);
  });

  it("does not trigger above the target, on stale prices, or on a different variant", async () => {
    const product = await setUp(70000);
    const { evaluateAlerts } = await import("@/lib/services/alerts");
    expect(await evaluateAlerts(db as never, [product.id as string])).toBe(0);

    // Make the cheapest listing stale: it must not count even though it is below target.
    db.table("price_alerts")[0].target_price = 71500;
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    db.table("listings").find((l) => l.store_key === "flipkart")!.last_observed_at = threeDaysAgo;
    expect(await evaluateAlerts(db as never, [product.id as string])).toBe(0);

    // A cheaper offer for another variant never satisfies the alert.
    db.table("listings").find((l) => l.store_key === "reliance-digital")!.current_price = 60000;
    expect(await evaluateAlerts(db as never, [product.id as string])).toBe(0);
    expect(sentMail).toHaveLength(0);
  });

  it("can watch a single store", async () => {
    const product = await setUp(72500, "amazon");
    const { evaluateAlerts } = await import("@/lib/services/alerts");
    expect(await evaluateAlerts(db as never, [product.id as string])).toBe(1);
    expect(db.table("price_alerts")[0]).toMatchObject({ triggered_store: "Amazon India", triggered_price: 71999 });
  });

  it("still notifies in-app when Gmail is not configured", async () => {
    delete process.env.GMAIL_APP_PASSWORD;
    const product = await setUp(71000);
    const { evaluateAlerts } = await import("@/lib/services/alerts");
    expect(await evaluateAlerts(db as never, [product.id as string])).toBe(1);
    expect(db.table("notifications")[0].email_status).toBe("skipped");
    expect(sentMail).toHaveLength(0);
  });
});

describe("scheduled collection", () => {
  it("refreshes tracked products, records a run and fires alerts", async () => {
    await search("iphone 16 128gb");
    const tracked = productByKey("gp:111");
    db.table("watchlist_items").push({ id: "w1", user_id: USER, product_id: tracked.id });
    db.table("price_alerts").push({ id: "a1", user_id: USER, product_id: tracked.id, listing_id: null, target_price: 71000, status: "active" });

    const { runCollection } = await import("@/lib/services/collect");
    const summary = await runCollection("cron");

    expect(summary).toMatchObject({ status: "success", productsChecked: 1, alertsTriggered: 1, failures: 0 });
    expect(summary.observationsWritten).toBeGreaterThan(0);
    // Only the tracked product was looked up (1 search + 1 offers call in total).
    expect(fetchCalls).toHaveLength(2);
    expect(db.table("collection_runs")[0]).toMatchObject({ status: "success", products_checked: 1, trigger: "cron" });
    expect(db.table("price_observations").every((o) => Number(o.price) > 0)).toBe(true);
    expect(sentMail).toHaveLength(1);
  });

  it("checks the least recently refreshed products first and respects the batch size", async () => {
    await search("iphone 16 128gb");
    const a = productByKey("gp:111");
    const b = productByKey("gp:222");
    a.offers_refreshed_at = new Date().toISOString();
    db.table("watchlist_items").push({ id: "w1", user_id: USER, product_id: a.id }, { id: "w2", user_id: USER, product_id: b.id });
    process.env.COLLECT_MAX_PRODUCTS = "1";

    const { runCollection } = await import("@/lib/services/collect");
    const summary = await runCollection("manual");
    expect(summary.productsChecked).toBe(1);
    expect(summary.note).toMatch(/1 tracked product/);
    expect(fetchCalls.at(-1)!.searchParams.get("product_id")).toBe("222");
  });

  it("reports failures without losing the run", async () => {
    await search("iphone 16 128gb");
    db.table("watchlist_items").push({ id: "w1", user_id: USER, product_id: productByKey("gp:111").id });
    failOffers = true;
    const { runCollection } = await import("@/lib/services/collect");
    const summary = await runCollection("cron");
    expect(summary).toMatchObject({ status: "failed", productsChecked: 0, failures: 1 });
    expect(db.table("collection_runs")[0].error_log).toHaveLength(1);
  });

  it("skips when the allowance is used up or nothing is tracked", async () => {
    const { runCollection } = await import("@/lib/services/collect");
    expect((await runCollection("cron")).note).toMatch(/No tracked products/);

    await search("iphone 16 128gb");
    db.table("watchlist_items").push({ id: "w1", user_id: USER, product_id: productByKey("gp:111").id });
    process.env.PROVIDER_MONTHLY_LIMIT = "1";
    const summary = await runCollection("cron");
    expect(summary.status).toBe("skipped");
    expect(summary.note).toMatch(/allowance/);
  });
});
