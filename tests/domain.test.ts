import { describe, expect, it } from "vitest";
import { categorise } from "@/lib/domain/categorise";
import { discountPct, formatINR } from "@/lib/domain/format";
import { buildDailySeries, buildGuidance, computeStats } from "@/lib/domain/insights";
import { parseQuery, queryCacheKey } from "@/lib/domain/parse-query";
import { normaliseStore } from "@/lib/domain/stores";
import {
  compareVariants,
  detectBrand,
  detectModel,
  parseVariant,
  titleMatchKey,
  variantKey,
} from "@/lib/domain/variants";

describe("parseVariant", () => {
  it("reads storage and colour from a phone title", () => {
    expect(parseVariant("Apple iPhone 15 (Black, 128 GB)")).toEqual({ storage: "128GB", colour: "black" });
  });

  it("separates RAM from storage", () => {
    expect(parseVariant("Samsung Galaxy S24 5G (Onyx Black, 8GB RAM, 256GB Storage)")).toMatchObject({
      ram: "8GB",
      storage: "256GB",
      colour: "black",
    });
    expect(parseVariant("OnePlus Nord CE4 8GB/128GB Dark Chrome")).toMatchObject({ ram: "8GB", storage: "128GB" });
    expect(parseVariant("Redmi Note 13 5G 6+128 GB Arctic White")).toMatchObject({ ram: "6GB", storage: "128GB", colour: "white" });
    expect(parseVariant("Lenovo IdeaPad Slim 3 16GB 512GB SSD")).toMatchObject({ ram: "16GB", storage: "512GB" });
  });

  it("handles terabytes and multi-word colours", () => {
    expect(parseVariant("Apple iPhone 16 Pro 1TB Desert Titanium")).toEqual({
      storage: "1TB",
      colour: "desert titanium",
    });
    expect(parseVariant("MacBook Air M3 Space Gray 256 GB")).toMatchObject({ colour: "space grey", storage: "256GB" });
  });

  it("does not read a colour out of a brand name", () => {
    expect(parseVariant("Blue Star 1.5 Ton 5 Star Inverter Split AC").colour).toBeUndefined();
    expect(parseVariant("Blue Star 1.5 Ton 5 Star Inverter Split AC").size).toBe("1.5ton");
  });

  it("reads sizes for TVs, appliances and shoes", () => {
    expect(parseVariant("Sony Bravia 139 cm (55 inches) 4K Google TV").size).toBe("55in");
    expect(parseVariant('LG 43" UHD Smart TV').size).toBe("43in");
    expect(parseVariant("Samsung 236 L 3 Star Double Door Refrigerator").size).toBe("236L");
    expect(parseVariant("IFB 7 kg Front Load Washing Machine").size).toBe("7kg");
    expect(parseVariant("Nike Revolution 7 Running Shoes UK 8").size).toBe("UK 8");
  });

  it("is not fooled by '2 in 1' or '5G'", () => {
    const v = parseVariant("HP Pavilion x360 2 in 1 Laptop 5G ready");
    expect(v.size).toBeUndefined();
    expect(v.storage).toBeUndefined();
  });
});

describe("compareVariants", () => {
  const base = parseVariant("Apple iPhone 15 128GB Black");

  it("treats a different storage size as a different product", () => {
    expect(compareVariants(base, parseVariant("iPhone 15 256 GB Black"))).toBe("different");
  });

  it("treats a different colour as a different product", () => {
    expect(compareVariants(base, parseVariant("iPhone 15 128GB Blue"))).toBe("different");
  });

  it("matches the same variant written differently", () => {
    expect(compareVariants(base, parseVariant("APPLE iPhone 15 (Black, 128 GB)"))).toBe("same");
  });

  it("says unknown when there is nothing to compare", () => {
    expect(compareVariants(base, parseVariant("Apple iPhone 15"))).toBe("unknown");
    expect(compareVariants({}, parseVariant("iPhone 15 128GB"))).toBe("unknown");
  });
});

describe("identity keys", () => {
  it("gives the same key regardless of word order, spacing and filler words", () => {
    expect(titleMatchKey("Apple iPhone 15 (128 GB) - Black")).toBe(titleMatchKey("iPhone 15 Black 128GB Apple smartphone"));
  });

  it("gives different keys to different variants", () => {
    expect(titleMatchKey("Apple iPhone 15 128GB Black")).not.toBe(titleMatchKey("Apple iPhone 15 256GB Black"));
    expect(titleMatchKey("Apple iPhone 15 128GB Black")).not.toBe(titleMatchKey("Apple iPhone 15 128GB Blue"));
  });

  it("builds an empty variant key when no variant is stated", () => {
    expect(variantKey({})).toBe("");
    expect(variantKey({ storage: "128GB", colour: "black" })).toBe("128gb||black|");
  });
});

describe("brand and model", () => {
  it("finds known brands, including multi-word ones", () => {
    expect(detectBrand("Samsung Galaxy S24 5G")).toBe("Samsung");
    expect(detectBrand("boAt Airdopes 141")).toBe("boAt");
    expect(detectBrand("Blue Star 1.5 Ton AC")).toBe("Blue Star");
    expect(detectBrand("HP Pavilion 15")).toBe("HP");
  });

  it("only falls back to the first word when asked", () => {
    expect(detectBrand("Zebronics Zeb-Thunder headphones")).toBe("Zebronics");
    expect(detectBrand("wireless earbuds", { fallbackToFirstWord: false })).toBeNull();
  });

  it("extracts model numbers but not capacities", () => {
    expect(detectModel("Sony WH-1000XM5 Wireless Headphones")).toBe("WH-1000XM5");
    expect(detectModel("Samsung Galaxy S24 5G 256GB")).toBeNull();
  });
});

describe("parseQuery", () => {
  it("extracts an upper price limit", () => {
    const q = parseQuery("samsung phone under 20k");
    expect(q.text).toBe("samsung phone");
    expect(q.maxPrice).toBe(20000);
    expect(q.brand).toBe("Samsung");
    expect(q.category).toBe("mobiles");
  });

  it("understands rupee symbols, commas and lakhs", () => {
    expect(parseQuery("laptop below ₹55,000").maxPrice).toBe(55000);
    expect(parseQuery("oled tv under 1.5 lakh").maxPrice).toBe(150000);
    expect(parseQuery("gaming laptop above rs 80000").minPrice).toBe(80000);
  });

  it("extracts a price range", () => {
    const q = parseQuery("headphones between 2000 and 5000");
    expect(q.minPrice).toBe(2000);
    expect(q.maxPrice).toBe(5000);
    expect(q.text).toBe("headphones");
    expect(parseQuery("phones from 10 to 20k")).toMatchObject({ minPrice: 10000, maxPrice: 20000 });
  });

  it("extracts a store", () => {
    const q = parseQuery("nike running shoes on myntra under 4000");
    expect(q.storeKey).toBe("myntra");
    expect(q.maxPrice).toBe(4000);
    expect(q.text).toBe("nike running shoes");
    expect(q.category).toBe("footwear");
  });

  it("leaves model numbers and sizes alone", () => {
    expect(parseQuery("iphone 15 128gb").text).toBe("iphone 15 128gb");
    expect(parseQuery("iphone 15 128gb").maxPrice).toBeUndefined();
    expect(parseQuery("fridge under 300 litres").maxPrice).toBeUndefined();
    expect(parseQuery("tv above 50 inch under 40000")).toMatchObject({ maxPrice: 40000 });
    expect(parseQuery("tv above 50 inch under 40000").minPrice).toBeUndefined();
  });

  it("strips filler words and notes a cheapest-first intent", () => {
    const q = parseQuery("show me the cheapest airpods pro");
    expect(q.text).toBe("airpods pro");
    expect(q.sort).toBe("price_asc");
  });

  it("builds a stable cache key", () => {
    expect(queryCacheKey("serpapi", parseQuery("Sony  WH-1000XM5 under 25000"))).toBe(
      queryCacheKey("serpapi", parseQuery("sony wh-1000xm5 below ₹25,000")),
    );
  });
});

describe("stores and categories", () => {
  it("maps store spellings to one key", () => {
    expect(normaliseStore("Amazon.in").key).toBe("amazon");
    expect(normaliseStore("from Flipkart").key).toBe("flipkart");
    expect(normaliseStore("Reliance Digital").key).toBe("reliance-digital");
    expect(normaliseStore("AJIO.com").name).toBe("AJIO");
    expect(normaliseStore("Some Shop.in").key).toBe("some-shop");
  });

  it("categorises common products", () => {
    expect(categorise("Apple iPhone 15 128GB")).toBe("mobiles");
    expect(categorise("Sony WH-1000XM5 headphones")).toBe("audio");
    expect(categorise("LG 1.5 Ton Split AC")).toBe("appliances");
    expect(categorise("Apple Watch Series 10")).toBe("wearables");
    expect(categorise("Mystery object")).toBe("other");
  });
});

describe("price insights", () => {
  const obs = (day: string, price: number, listing = "a", hour = "06") => ({
    listing_id: listing,
    price,
    observed_at: `${day}T${hour}:00:00Z`,
  });

  it("keeps the lowest price per India day", () => {
    const series = buildDailySeries([
      obs("2026-10-01", 60000, "a"),
      obs("2026-10-01", 58000, "b"),
      // 20:00 UTC is already the next day in India.
      obs("2026-10-01", 57000, "a", "20"),
    ]);
    expect(series).toEqual([
      { day: "2026-10-01", at: "2026-10-01T06:00:00Z", price: 58000 },
      { day: "2026-10-02", at: "2026-10-01T20:00:00Z", price: 57000 },
    ]);
  });

  it("can exclude listings (for example a different variant)", () => {
    const series = buildDailySeries([obs("2026-10-01", 60000, "a"), obs("2026-10-01", 40000, "other")], (id) => id !== "other");
    expect(series[0].price).toBe(60000);
  });

  it("computes high, low, average and changes", () => {
    const series = buildDailySeries([
      obs("2026-08-01", 65000),
      obs("2026-09-01", 62000),
      obs("2026-10-01", 59000),
      obs("2026-10-25", 56000),
      obs("2026-11-01", 55000),
    ]);
    const stats = computeStats(series)!;
    expect(stats.current).toBe(55000);
    expect(stats.high).toBe(65000);
    expect(stats.low).toBe(55000);
    expect(stats.average).toBe(59400);
    expect(stats.average30).toBe(55500); // 25 Oct and 1 Nov
    expect(stats.days).toBe(5);
    expect(stats.spanDays).toBe(92);
    expect(stats.changes.find((c) => c.days === 7)).toMatchObject({ from: 56000, pct: -1.79 });
    expect(stats.changes.find((c) => c.days === 30)).toMatchObject({ from: 59000, pct: -6.78 });
    expect(stats.changes.find((c) => c.days === 90)).toMatchObject({ from: 65000, pct: -15.38 });
    expect(stats.nearLow).toBe(true);
  });

  it("refuses to give guidance without a week of history", () => {
    const stats = computeStats(buildDailySeries([obs("2026-11-01", 55000), obs("2026-11-02", 54000)]));
    const g = buildGuidance(stats);
    expect(g.level).toBe("insufficient");
    expect(buildGuidance(null).level).toBe("insufficient");
  });

  it("calls a price good only when history supports it", () => {
    const days = ["01", "03", "05", "07", "09", "11"];
    const good = computeStats(buildDailySeries(days.map((d, i) => obs(`2026-10-${d}`, i === 5 ? 50000 : 60000))))!;
    expect(buildGuidance(good).level).toBe("good");
    expect(buildGuidance(good).headline).toBe("Good price based on recorded history");

    const high = computeStats(buildDailySeries(days.map((d, i) => obs(`2026-10-${d}`, i === 5 ? 70000 : 60000))))!;
    expect(buildGuidance(high).level).toBe("high");
    expect(buildGuidance(high).headline).toBe("Consider monitoring");

    const flat = computeStats(buildDailySeries(days.map((d) => obs(`2026-10-${d}`, 60000))))!;
    expect(buildGuidance(flat).level).toBe("fair");
  });
});

describe("formatting", () => {
  it("formats rupees the Indian way", () => {
    expect(formatINR(155000)).toBe("₹1,55,000");
    expect(formatINR(499.5)).toBe("₹499.50");
    expect(formatINR(null)).toBe("—");
  });

  it("computes a discount only when the list price is higher", () => {
    expect(discountPct(750, 1000)).toBe(25);
    expect(discountPct(1000, 1000)).toBeNull();
    expect(discountPct(1000, null)).toBeNull();
  });
});
