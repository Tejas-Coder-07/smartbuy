/**
 * A product-data source. SmartBuy never talks to a retailer directly: every
 * price comes through an adapter that implements this interface, so sources
 * can be added or swapped without touching search, history or alerts.
 */
export interface ProductProvider {
  /** Short stable id stored with every observation, e.g. "serpapi". */
  readonly id: string;
  /** Name shown in the admin dashboard. */
  readonly name: string;
  /** Whether the credentials this source needs are present. */
  isConfigured(): boolean;
  /** Text search across stores. One call to the source. */
  search(query: ProviderSearchQuery): Promise<ProviderSearchItem[]>;
  /** Every store's current offer for one product. One call to the source. */
  offers(ref: ProviderProductRef): Promise<ProviderOffersResult>;
}

export type ProviderSearchQuery = {
  text: string;
  minPrice?: number;
  maxPrice?: number;
};

export type ProviderSearchItem = {
  /** The source's own id for the product, when it has one. */
  providerProductId: string | null;
  /** Opaque token some sources need to fetch offers later. */
  token: string | null;
  title: string;
  /** Store that the quoted price belongs to. */
  store: string;
  price: number;
  mrp: number | null;
  imageUrl: string | null;
  url: string | null;
  rating: number | null;
  reviewCount: number | null;
  delivery: string | null;
};

export type ProviderProductRef = {
  providerProductId: string | null;
  token: string | null;
};

export type ProviderOffer = {
  store: string;
  title: string;
  url: string | null;
  price: number;
  mrp: number | null;
  shipping: string | null;
  detail: string | null;
};

export type ProviderOffersResult = {
  offers: ProviderOffer[];
  token?: string | null;
};

export type ProviderErrorKind = "not_configured" | "auth" | "quota" | "http" | "invalid_response" | "timeout";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;

  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}
