import type { Variant, VariantMatch } from "./types";

/**
 * Variant-aware product matching.
 *
 * A 128 GB phone and a 256 GB phone are different products, and so are two
 * colours or two sizes of the same model. Everything here works on listing
 * titles, because that is the one field every data source provides.
 */

const MULTI_WORD_COLOURS = [
  "natural titanium",
  "desert titanium",
  "black titanium",
  "white titanium",
  "blue titanium",
  "space grey",
  "space black",
  "midnight green",
  "midnight black",
  "midnight blue",
  "sky blue",
  "ice blue",
  "rose gold",
  "jet black",
  "matte black",
  "phantom black",
  "mint green",
  "sage green",
  "navy blue",
  "deep purple",
  "pacific blue",
  "sierra blue",
  "alpine green",
  "cosmic orange",
  "mist blue",
  "deep blue",
  "light blue",
  "dark blue",
  "light green",
  "dark green",
  "off white",
];

const SINGLE_COLOURS = [
  "black",
  "white",
  "blue",
  "red",
  "green",
  "yellow",
  "pink",
  "purple",
  "violet",
  "orange",
  "silver",
  "gold",
  "grey",
  "graphite",
  "midnight",
  "starlight",
  "titanium",
  "teal",
  "ultramarine",
  "lavender",
  "mint",
  "cream",
  "beige",
  "brown",
  "navy",
  "maroon",
  "olive",
  "coral",
  "bronze",
  "copper",
  "champagne",
  "charcoal",
  "ivory",
  "turquoise",
  "cyan",
  "magenta",
  "lilac",
  "peach",
  "burgundy",
  "khaki",
];

/** Brand names that contain a colour word and must not be read as a colour. */
const COLOUR_LOOKALIKE_BRANDS = [
  "blue star",
  "black shark",
  "black+decker",
  "black & decker",
  "black and decker",
  "red tape",
  "red chief",
  "white westinghouse",
  "pink city",
  "orange pi",
  "gold flake",
];

const BRANDS = [
  "u.s. polo assn",
  "us polo assn",
  "tommy hilfiger",
  "jack & jones",
  "peter england",
  "allen solly",
  "van heusen",
  "new balance",
  "blue star",
  "black shark",
  "red tape",
  "the north face",
  "louis philippe",
  "calvin klein",
  "under armour",
  "apple",
  "samsung",
  "oneplus",
  "xiaomi",
  "redmi",
  "poco",
  "realme",
  "vivo",
  "oppo",
  "motorola",
  "nokia",
  "google",
  "nothing",
  "iqoo",
  "infinix",
  "tecno",
  "lava",
  "honor",
  "sony",
  "lg",
  "panasonic",
  "tcl",
  "hisense",
  "toshiba",
  "sansui",
  "boat",
  "jbl",
  "bose",
  "sennheiser",
  "noise",
  "boult",
  "marshall",
  "skullcandy",
  "hp",
  "dell",
  "lenovo",
  "asus",
  "acer",
  "msi",
  "microsoft",
  "canon",
  "nikon",
  "fujifilm",
  "gopro",
  "dji",
  "whirlpool",
  "bosch",
  "ifb",
  "haier",
  "godrej",
  "voltas",
  "daikin",
  "hitachi",
  "carrier",
  "lloyd",
  "philips",
  "bajaj",
  "havells",
  "prestige",
  "pigeon",
  "dyson",
  "kent",
  "eureka forbes",
  "nike",
  "adidas",
  "puma",
  "reebok",
  "skechers",
  "asics",
  "bata",
  "woodland",
  "crocs",
  "campus",
  "sparx",
  "levi's",
  "levis",
  "h&m",
  "zara",
  "roadster",
  "biba",
  "fabindia",
  "titan",
  "fastrack",
  "casio",
  "fossil",
  "garmin",
  "fitbit",
  "amazfit",
  "lakme",
  "maybelline",
  "l'oreal",
  "nivea",
  "mamaearth",
  "wildcraft",
  "american tourister",
  "safari",
  "skybags",
];

const STOPWORDS = new Set([
  "with",
  "and",
  "the",
  "for",
  "of",
  "in",
  "a",
  "an",
  "new",
  "latest",
  "smartphone",
  "mobile",
  "phone",
  "edition",
  "model",
  "pack",
  "combo",
  "free",
  "offer",
  "india",
  "indian",
  "version",
  "unlocked",
  "warranty",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordPattern(phrase: string, flags = ""): RegExp {
  return new RegExp(`(?<![a-z0-9])${escapeRegex(phrase)}(?![a-z0-9])`, flags);
}

function normaliseText(title: string): string {
  return title
    .toLowerCase()
    .replace(/[“”″]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\bgray\b/g, "grey")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCapacity(value: number, unit: string): string {
  const n = Number.isInteger(value) ? String(value) : String(value);
  return `${n}${unit.toUpperCase()}`;
}

function toGb(value: number, unit: string): number {
  return unit === "tb" ? value * 1024 : value;
}

function parseCapacities(t: string): Pick<Variant, "storage" | "ram"> {
  let ram: string | undefined;
  let storage: string | undefined;

  // "8/128GB", "8+256 GB", "8GB/128GB", "8GB + 128GB"
  const pair = t.match(
    /(?<![a-z0-9.])(\d{1,2})\s*(?:gb)?\s*(?:ram)?\s*[/+|]\s*(\d{2,4}|\d(?:\.\d)?)\s*(gb|tb)(?![a-z])/,
  );
  if (pair) {
    const first = Number(pair[1]);
    const second = Number(pair[2]);
    const secondGb = toGb(second, pair[3]);
    if (first <= 24 && secondGb >= 32) {
      ram = formatCapacity(first, "gb");
      storage = formatCapacity(second, pair[3]);
    }
  }

  const unlabelled: { value: number; unit: string }[] = [];
  const re = /(?<![a-z0-9.])(\d+(?:\.\d+)?)\s*(gb|tb)(?![a-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const value = Number(m[1]);
    const unit = m[2];
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 12);
    const before = t.slice(Math.max(0, m.index - 8), m.index);
    if (/^\s*(?:of\s+)?(?:lpddr\w*\s+|ddr\w*\s+)?ram\b/.test(after) || /\bram[\s:-]*$/.test(before)) {
      ram ??= formatCapacity(value, unit);
    } else if (
      /^\s*(?:of\s+)?(?:rom|storage|ssd|hdd|internal|emmc|ufs|nvme)\b/.test(after) ||
      /\b(?:rom|storage|ssd|hdd)[\s:-]*$/.test(before)
    ) {
      storage ??= formatCapacity(value, unit);
    } else {
      unlabelled.push({ value, unit });
    }
  }

  const sorted = unlabelled
    .filter((c) => formatCapacity(c.value, c.unit) !== ram && formatCapacity(c.value, c.unit) !== storage)
    .sort((a, b) => toGb(a.value, a.unit) - toGb(b.value, b.unit));

  if (sorted.length >= 2) {
    const small = sorted[0];
    const large = sorted[sorted.length - 1];
    if (!ram && toGb(small.value, small.unit) <= 24 && toGb(large.value, large.unit) >= 32) {
      ram = formatCapacity(small.value, small.unit);
    }
    if (!storage) storage = formatCapacity(large.value, large.unit);
  } else if (sorted.length === 1) {
    const only = sorted[0];
    const gb = toGb(only.value, only.unit);
    if (gb >= 32) {
      storage ??= formatCapacity(only.value, only.unit);
    } else if (!ram) {
      ram = formatCapacity(only.value, only.unit);
    }
  }

  return { storage, ram };
}

function parseColour(t: string): string | undefined {
  let text = t;
  for (const brand of COLOUR_LOOKALIKE_BRANDS) {
    text = text.replace(wordPattern(brand, "g"), " ");
  }
  let best: { colour: string; index: number } | undefined;
  for (const colour of MULTI_WORD_COLOURS) {
    const idx = text.search(wordPattern(colour));
    if (idx >= 0 && (!best || idx < best.index)) best = { colour, index: idx };
  }
  if (best) return best.colour;
  for (const colour of SINGLE_COLOURS) {
    const idx = text.search(wordPattern(colour));
    if (idx >= 0 && (!best || idx < best.index)) best = { colour, index: idx };
  }
  return best?.colour;
}

function trimNumber(n: string): string {
  return n.replace(/\.0$/, "");
}

function parseSize(t: string): string | undefined {
  const inch = t.match(/(?<![a-z0-9.])(\d{2,3}(?:\.\d)?)\s*-?\s*(?:inch(?:es)?\b|"|'')/);
  if (inch) return `${trimNumber(inch[1])}in`;

  const ton = t.match(/(?<![a-z0-9.])(\d(?:\.\d)?)\s*-?\s*ton(?:s|ne)?\b/);
  if (ton) return `${trimNumber(ton[1])}ton`;

  const litre = t.match(/(?<![a-z0-9.])(\d{1,4}(?:\.\d)?)\s*-?\s*(?:l|ltr|litres?|liters?)\b/);
  if (litre) return `${trimNumber(litre[1])}L`;

  const kg = t.match(/(?<![a-z0-9.])(\d{1,2}(?:\.\d)?)\s*-?\s*kg\b/);
  if (kg) return `${trimNumber(kg[1])}kg`;

  const shoe = t.match(/\b(uk|us|eu|ind)\s?-?\s?(\d{1,2}(?:\.5)?)\b/);
  if (shoe) return `${shoe[1].toUpperCase()} ${shoe[2]}`;

  const apparel = t.match(/\bsize[\s:-]+((?:[2-5]?x{1,3}|x{0,3})[sml]|\d{1,3})\b/);
  if (apparel) return apparel[1].toUpperCase();

  const cm = t.match(/(?<![a-z0-9.])(\d{2,3})\s*cm\b/);
  if (cm) return `${cm[1]}cm`;

  return undefined;
}

export function parseVariant(title: string): Variant {
  const t = normaliseText(title);
  const { storage, ram } = parseCapacities(t);
  const colour = parseColour(t);
  const size = parseSize(t);
  const v: Variant = {};
  if (storage) v.storage = storage;
  if (ram) v.ram = ram;
  if (colour) v.colour = colour;
  if (size) v.size = size;
  return v;
}

export function variantKey(v: Variant): string {
  const parts = [v.storage ?? "", v.ram ?? "", v.colour ?? "", v.size ?? ""];
  return parts.every((p) => p === "") ? "" : parts.join("|").toLowerCase();
}

export function variantLabel(v: Variant): string {
  const parts: string[] = [];
  if (v.ram) parts.push(`${v.ram} RAM`);
  if (v.storage) parts.push(v.storage);
  if (v.colour) parts.push(v.colour.replace(/\b\w/g, (c) => c.toUpperCase()));
  if (v.size) parts.push(v.size.replace(/in$/, '"'));
  return parts.join(", ");
}

/**
 * Compare a listing's variant with the product's variant.
 *  - "different": at least one attribute is stated on both sides and differs
 *  - "same": at least one attribute is stated on both sides and all agree
 *  - "unknown": nothing to compare
 */
export function compareVariants(product: Variant, listing: Variant): VariantMatch {
  const attrs: (keyof Variant)[] = ["storage", "ram", "colour", "size"];
  let compared = 0;
  for (const a of attrs) {
    const p = product[a];
    const l = listing[a];
    if (p && l) {
      compared += 1;
      if (p.toLowerCase() !== l.toLowerCase()) return "different";
    }
  }
  return compared > 0 ? "same" : "unknown";
}

export function detectBrand(title: string, options: { fallbackToFirstWord?: boolean } = {}): string | null {
  const fallback = options.fallbackToFirstWord ?? true;
  const t = normaliseText(title);
  let best: { brand: string; index: number } | null = null;
  for (const brand of BRANDS) {
    const idx = t.search(wordPattern(brand));
    if (idx >= 0 && (best === null || idx < best.index || (idx === best.index && brand.length > best.brand.length))) {
      best = { brand, index: idx };
    }
  }
  if (best && best.index <= 40) return titleCase(best.brand);
  if (!fallback) return null;
  const first = title.trim().split(/\s+/)[0] ?? "";
  if (/^[A-Za-z][A-Za-z&'.-]{1,}$/.test(first) && !STOPWORDS.has(first.toLowerCase())) {
    return titleCase(first.toLowerCase());
  }
  return null;
}

const BRAND_CASE: Record<string, string> = {
  hp: "HP",
  lg: "LG",
  jbl: "JBL",
  msi: "MSI",
  tcl: "TCL",
  ifb: "IFB",
  dji: "DJI",
  iqoo: "iQOO",
  oneplus: "OnePlus",
  boat: "boAt",
  gopro: "GoPro",
  "h&m": "H&M",
  asus: "ASUS",
  poco: "POCO",
};

function titleCase(s: string): string {
  if (BRAND_CASE[s]) return BRAND_CASE[s];
  return s.replace(/(^|[\s.&-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

const NOT_A_MODEL = /^(?:\d+(?:\.\d+)?(?:gb|tb|mah|mp|hz|w|k|g|in|inch|cm|mm|kg|l|ton|v|nm|fps|p|x)|[2-6]g|wifi\d?|wi-fi\d?|usb\d?|type-?c|h\d{3}|ip\d{2}|\d+in1)$/;

export function detectModel(title: string): string | null {
  const tokens = title.split(/[\s,()|[\]]+/).filter(Boolean);
  for (const raw of tokens) {
    const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (token.length < 4) continue;
    if (!/[A-Za-z]/.test(token) || !/\d/.test(token)) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9\-/.]+$/.test(token)) continue;
    if (NOT_A_MODEL.test(token.toLowerCase())) continue;
    return token.toUpperCase();
  }
  return null;
}

/**
 * Identity key built from a title alone, used when the data source gives no
 * product id. Word order and filler words are ignored; variant words are
 * kept, so "… 128GB Black" and "… 256GB Black" never collapse together.
 */
export function titleMatchKey(title: string): string {
  const t = normaliseText(title)
    .replace(/(\d)\s+(gb|tb)\b/g, "$1$2")
    .replace(/[^a-z0-9.+ ]+/g, " ");
  const tokens = Array.from(
    new Set(
      t
        .split(/\s+/)
        .map((w) => w.replace(/^\.+|\.+$/g, ""))
        .filter((w) => w.length > 0 && !STOPWORDS.has(w)),
    ),
  ).sort();
  return tokens.join("-").slice(0, 200);
}
