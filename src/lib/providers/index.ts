import { serpApiProvider } from "./serpapi";
import type { ProductProvider } from "./types";

/**
 * Registered data sources. To add one (for example an approved retailer
 * affiliate API), implement ProductProvider in a new file and list it here.
 */
const PROVIDERS: Record<string, ProductProvider> = {
  [serpApiProvider.id]: serpApiProvider,
};

export function getProvider(): ProductProvider {
  const wanted = process.env.PRODUCT_PROVIDER || serpApiProvider.id;
  return PROVIDERS[wanted] ?? serpApiProvider;
}

export function listProviders(): ProductProvider[] {
  return Object.values(PROVIDERS);
}

export { ProviderError } from "./types";
export type { ProductProvider } from "./types";
