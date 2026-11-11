import { afterEach, describe, expect, it, vi } from "vitest";
import { mapOffersResponse, mapSearchResponse, serpApiProvider } from "@/lib/providers/serpapi";
import { ProviderError } from "@/lib/providers/types";

describe("SerpApi response mapping", () => {
  it("reads categorised results as well as the flat list", () => {
    const items = mapSearchResponse({
      shopping_results: [{ title: "A", source: "Croma", extracted_price: 100, price: "₹100" }],
      categorized_shopping_results: [
        { title: "Popular", shopping_results: [{ title: "B", source: "Flipkart", extracted_price: 200, price: "₹200" }] },
      ],
    });
    expect(items.map((i) => i.title)).toEqual(["A", "B"]);
  });

  it("ignores a list price that is not above the selling price", () => {
    const [item] = mapSearchResponse({
      shopping_results: [{ title: "A", source: "Croma", extracted_price: 100, extracted_old_price: 100 }],
    });
    expect(item.mrp).toBeNull();
  });

  it("tolerates missing or malformed sections", () => {
    expect(mapSearchResponse({})).toEqual([]);
    expect(mapSearchResponse({ shopping_results: "nope" })).toEqual([]);
    expect(mapOffersResponse({}).offers).toEqual([]);
    expect(mapOffersResponse({ product_results: { stores: [null, { name: "X" }] } }).offers).toEqual([]);
  });

  it("uses the product title when a store offer has none", () => {
    const { offers, token } = mapOffersResponse({
      product_results: { title: "Thing 64GB", page_token: "t", stores: [{ name: "Croma", extracted_price: 10, link: "javascript:alert(1)" }] },
    });
    expect(offers[0]).toMatchObject({ title: "Thing 64GB", url: null, price: 10 });
    expect(token).toBe("t");
  });
});

describe("SerpApi errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SERPAPI_API_KEY;
  });

  async function failure(run: () => Promise<unknown>): Promise<ProviderError> {
    try {
      await run();
    } catch (err) {
      return err as ProviderError;
    }
    throw new Error("expected a failure");
  }

  it("reports a missing key without calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const err = await failure(() => serpApiProvider.search({ text: "x" }));
    expect(err.kind).toBe("not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("classifies a rejected key, an empty answer and a network failure", async () => {
    process.env.SERPAPI_API_KEY = "k";

    vi.stubGlobal("fetch", async () => Response.json({ error: "Invalid API key." }, { status: 401 }));
    expect((await failure(() => serpApiProvider.search({ text: "x" }))).kind).toBe("auth");

    vi.stubGlobal("fetch", async () => Response.json({ error: "Google hasn't returned any results for this query." }));
    expect(await serpApiProvider.search({ text: "x" })).toEqual([]);

    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect((await failure(() => serpApiProvider.search({ text: "x" }))).kind).toBe("http");

    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 502 }));
    expect((await failure(() => serpApiProvider.search({ text: "x" }))).kind).toBe("invalid_response");
  });

  it("falls back to the page token when a product has no id", async () => {
    process.env.SERPAPI_API_KEY = "k";
    const urls: URL[] = [];
    vi.stubGlobal("fetch", async (u: URL) => {
      urls.push(new URL(String(u)));
      return Response.json({ product_results: { stores: [] } });
    });
    await serpApiProvider.offers({ providerProductId: null, token: "tok" });
    expect(urls[0].searchParams.get("engine")).toBe("google_immersive_product");
    expect(urls[0].searchParams.get("page_token")).toBe("tok");
    await expect(serpApiProvider.offers({ providerProductId: null, token: null })).rejects.toThrow();
  });
});
