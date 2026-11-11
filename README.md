# SmartBuy

Shopping search and price intelligence for Indian online stores, built by the
OSCODE Tech Team. Search once to compare stores, see the recorded price
history of a product, and get an alert when it reaches a target price.

**Setting it up:** see [SETUP.md](./SETUP.md).

## What it does

- **Product search** by name, model number or description. Queries such as
  "samsung phone under 20k on flipkart" are understood: the price limit and
  the store become filters.
- **Multi-store comparison** with variant-aware matching, so a 128 GB phone is
  never compared with a 256 GB one.
- **Price history**: every price check is stored with its time and source.
  Each product shows its highest, lowest and average recorded price, a 30-day
  average, and a graph.
- **Price intelligence**: "Good price based on recorded history" or "Consider
  monitoring", computed only from recorded prices. No forecasts.
- **Watchlist and alerts**: in-app and by email when a freshly checked price
  reaches the target.
- **User dashboard**: alerts received, watchlist, tracked prices, recent
  searches.
- **Admin dashboard**: users, search activity, data-source status and usage,
  collection jobs and failures, data freshness.

## How it is built

| Part | Choice |
|------|--------|
| App | Next.js 16 (App Router, TypeScript), Tailwind CSS 4 |
| Database and sign-in | Supabase (Postgres, row-level security, email and password) |
| Product data | SerpApi Google Shopping (India), behind a provider interface |
| Email | Gmail through Nodemailer |
| Hosting and schedule | Vercel, with a daily Vercel Cron job |

```
src/app/            pages, server actions, the cron endpoint
src/components/     header, forms, price chart, shared UI
src/lib/domain/     pure logic: query parsing, variant matching, insights
src/lib/providers/  product-data sources (add new ones here)
src/lib/services/   search, ingest, offers, alerts, collection, email
supabase/migrations database schema and access rules
tests/              automated tests
```

## Commands

```bash
npm run dev        # start locally
npm run build      # production build
npm test           # run the tests
npm run typecheck  # TypeScript only
npm run lint       # ESLint
```
