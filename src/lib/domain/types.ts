export type Variant = {
  storage?: string; // "128GB", "1TB"
  ram?: string; // "8GB"
  colour?: string; // "black"
  size?: string; // "55in", "UK 8", "M"
};

export type VariantMatch = "same" | "different" | "unknown";

export type Category =
  | "mobiles"
  | "laptops"
  | "tablets"
  | "audio"
  | "tvs"
  | "wearables"
  | "cameras"
  | "appliances"
  | "gaming"
  | "fashion"
  | "footwear"
  | "beauty"
  | "home"
  | "other";

export type ProductRow = {
  id: string;
  match_key: string;
  title: string;
  brand: string | null;
  model: string | null;
  category: Category;
  variant: Variant;
  image_url: string | null;
  provider: string;
  provider_product_id: string | null;
  provider_token: string | null;
  rating: number | null;
  review_count: number | null;
  offers_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ListingRow = {
  id: string;
  product_id: string;
  store: string;
  store_key: string;
  variant_key: string;
  variant: Variant;
  variant_match: VariantMatch;
  title: string;
  url: string | null;
  current_price: number | null;
  mrp: number | null;
  shipping: string | null;
  detail: string | null;
  provider: string;
  last_observed_at: string | null;
  created_at: string;
};

export type ObservationRow = {
  listing_id: string;
  price: number;
  observed_at: string;
};

export type ProductWithListings = ProductRow & { listings: ListingRow[] };
