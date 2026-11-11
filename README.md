# SmartBuy

Shopping search and price intelligence for Indian online stores, built by the
OSCODE Tech Team. Search once to compare stores, see the recorded price
history of a product, and get an alert when it reaches a target price.

**Live site:** <https://smartbuy-ashy.vercel.app>

## Where everything is

| What | Where | Notes |
|------|-------|-------|
| Live website | <https://smartbuy-ashy.vercel.app> | Public. Also reachable at `smartbuy-tejas-1869.vercel.app` |
| Source code | <https://github.com/Tejas-Coder-07/smartbuy> | Branch `main`. Every push redeploys the site |
| Hosting | <https://vercel.com/tejas-1869/smartbuy> | Vercel project `smartbuy`, Hobby plan, region Mumbai (`bom1`) |
| Settings and secrets | <https://vercel.com/tejas-1869/smartbuy/settings/environment-variables> | Eight variables; names listed below |
| Deployments and logs | <https://vercel.com/tejas-1869/smartbuy/deployments> | Build history and server logs |
| Database and sign-in | <https://supabase.com/dashboard/project/tgpxjjegtukeyxezpovt> | Supabase project `smartbuy`, Free plan, region Mumbai (`ap-south-1`) |
| Database tables | <https://supabase.com/dashboard/project/tgpxjjegtukeyxezpovt/editor> | 12 tables, all with row-level security |
| Sign-in users | <https://supabase.com/dashboard/project/tgpxjjegtukeyxezpovt/auth/users> | Everyone who has created an account |
| Product-data source | <https://serpapi.com/dashboard> | SerpApi account; shows searches used this month |
| Alert-email sender | <https://myaccount.google.com/apppasswords> | The Gmail app passwords used by the site and by Supabase |
| Admin page | <https://smartbuy-ashy.vercel.app/admin> | Visible only to the administrator account |
| Setup guide | [SETUP.md](./SETUP.md) | How to recreate all of this from scratch |
| Database schema | [supabase/migrations/0001_smartbuy_schema.sql](./supabase/migrations/0001_smartbuy_schema.sql) | Tables, access rules, admin functions |

The Vercel, Supabase, SerpApi and Google links open only for the project
owner's accounts.

## What it does

- **Product search** by name, model number or description. A query such as
  "samsung phone under 20k on flipkart" is understood: the price limit and
  the store become filters.
- **Multi-store comparison** with variant-aware matching, so a 128 GB phone is
  never compared with a 256 GB one.
- **Price history.** Every price check is stored with its time and source.
  Each product shows its highest, lowest and average recorded price, a 30-day
  average, and a graph.
- **Price intelligence.** "Good price based on recorded history" or "Consider
  monitoring", computed only from recorded prices. No forecasts.
- **Watchlist and alerts**, in-app and by email, when a freshly checked price
  reaches the target.
- **User dashboard:** alerts received, watchlist, tracked prices, recent
  searches.
- **Admin dashboard:** users, search activity, data-source status and usage,
  collection jobs and failures, data freshness.

## Pages

| Page | Address | Who can open it |
|------|---------|-----------------|
| Home and search box | `/` | Everyone |
| Search results | `/search?q=...` | Everyone sees saved results; live lookups need sign-in |
| Product: stores, history, alert | `/product/<id>` | Everyone; saving and alerts need sign-in |
| Create account / Sign in | `/signup`, `/login` | Everyone |
| Reset password | `/forgot-password`, `/update-password` | Everyone |
| Dashboard | `/dashboard` | Signed-in members |
| Administration | `/admin` | Administrators |
| Daily price collection | `/api/cron/collect` | Vercel Cron only (needs `CRON_SECRET`) |

## How it works

1. **Search.** The query is parsed (price limits, store, brand, category) and
   looked up in a 12-hour cache. If it is not cached and the visitor is signed
   in, SmartBuy asks SerpApi for Google Shopping results for India, stores the
   products, and records each price as a timestamped observation.
2. **Compare all stores.** On a product page, one more lookup fetches every
   store's offer for that product. Offers that state a different storage size,
   colour or size are listed separately and never used for the lowest price,
   the history or alerts.
3. **Daily collection.** At 7:00 am IST, Vercel Cron calls
   `/api/cron/collect`. It refreshes the tracked products (anything on a
   watchlist or with an active alert) that were checked longest ago, then
   evaluates alerts.
4. **Alerts.** When a price checked in the last 36 hours is at or below a
   member's target, SmartBuy creates a dashboard notification, sends an email
   through Gmail, and switches the alert off until it is set again.

Lookups are limited so the SerpApi allowance lasts the month:

| Limit | Default | Setting |
|-------|---------|---------|
| Lookups per calendar month | 250 | `PROVIDER_MONTHLY_LIMIT` |
| Live lookups per member per day | 15 | `USER_DAILY_LIVE_LIMIT` |
| Tracked products refreshed per daily run | 6 | `COLLECT_MAX_PRODUCTS` |
| Hours a search or a store comparison is reused | 12 | `SEARCH_CACHE_HOURS`, `OFFERS_CACHE_HOURS` |

## How it is built

| Part | Choice |
|------|--------|
| App | Next.js 16 (App Router, TypeScript), Tailwind CSS 4 |
| Database and sign-in | Supabase: Postgres, row-level security, email and password |
| Product data | SerpApi Google Shopping (India), behind a provider interface |
| Email | Gmail through Nodemailer |
| Hosting and schedule | Vercel, with a daily Vercel Cron job |

```
src/app/              pages, server actions, the cron endpoint
src/components/       header, forms, price chart, shared UI
src/lib/domain/       pure logic: query parsing, variant matching, insights
src/lib/providers/    product-data sources (add new ones here)
src/lib/services/     search, ingest, offers, alerts, collection, email
src/lib/supabase/     database clients and session handling
supabase/migrations/  database schema and access rules
tests/                automated tests
```

### Database tables

| Table | Holds |
|-------|-------|
| `products` | One row per distinct product and variant |
| `listings` | One row per store offer of a product |
| `price_observations` | Every recorded price, with time and source. This is the price history |
| `search_cache`, `searches` | Reused search results; the search activity log |
| `watchlist_items`, `price_alerts`, `notifications` | Each member's saved products, targets and alerts received |
| `collection_runs`, `provider_calls` | Daily job results; every data-source lookup and its outcome |
| `profiles`, `admin_emails` | One profile per account; who is an administrator |

Products, listings and price history are public to read. Watchlists, alerts,
notifications and searches are visible only to their owner. Operations tables
are visible only to administrators. All writes to the catalogue go through the
server.

### Settings on Vercel

Values live only in Vercel and are never stored in this repository.

| Name | Purpose |
|------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project address |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase public key |
| `SUPABASE_SECRET_KEY` | Lets the server store prices, searches and alerts |
| `SERPAPI_API_KEY` | Product-data source |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_FROM_NAME` | Alert emails |
| `CRON_SECRET` | Protects the daily collection endpoint |

After changing any of them, redeploy from the Vercel deployments page.

## Project log

What was done to get here, in order.

**11 November 2026: build**

- Read the SmartBuy project proposal and built the full scope in it: search,
  comparison, price history, insights, watchlist, alerts, user and admin
  dashboards.
- Chose SerpApi (Google Shopping, India) as the first data source, because the
  official Amazon and Flipkart routes need affiliate approvals the team does
  not have yet. The app ships with no sample products or prices.
- Wrote 62 automated tests: the database rules on a real Postgres engine, the
  query parsing and variant matching, and the whole price pipeline with
  stand-ins for SerpApi, the database API and Gmail.

**11 November 2026: launch**

- Created the Supabase project `smartbuy` in Mumbai and applied the schema.
- Pushed the code to this repository. The owner's email address was removed
  from the files first, because the repository is public.
- Created the Vercel project, linked it to this repository, added the
  settings, and deployed. The function region was moved to Mumbai to sit next
  to the database, and the main site address was made public.
- Added the three secrets (Supabase secret key, SerpApi key, Gmail app
  password) in Vercel and redeployed.
- Created the administrator account.

**Problems met during launch, and what fixed them**

| Problem | Cause | Fix |
|---------|-------|-----|
| Confirmation link confirmed the email but did not sign in | Supabase's default links only work in the browser that started the sign-up | Use `token_hash` links in the email templates (SETUP.md, step 1.7). The site now also says "email confirmed, sign in" when this happens |
| "email rate limit exceeded" on password reset | Supabase's built-in sender allows only a few emails an hour | Send sign-in emails through Gmail SMTP (SETUP.md, step 1.6) |
| Vercel connection could not create the project | The connection had no access to the Vercel team | Access approved by the owner |

## Status on 11 November 2026

**Checked on the live site**

- The home page, sign-in and dashboard load without server errors.
- The site reads from and writes to the Supabase database.
- Account creation, email confirmation and sign-in work.

**Not yet checked live**

- A signed-in search, which is the first real call to SerpApi.
- "Compare all stores", the daily collection job and an alert email.

These run the first time a signed-in member searches. The admin page lists any
failed lookup with its error.

## Things to know

- **Where prices come from.** SmartBuy reads Google Shopping results through
  SerpApi, a third-party data service. It is not an API approved by Amazon,
  Flipkart, Myntra, AJIO, Croma or Reliance Digital, and a store appears only
  when Google Shopping lists its offer. An approved retailer or affiliate API
  can be added in `src/lib/providers/` without changing the rest.
- **History starts on day one.** A product has no price history until SmartBuy
  first checks it. Buying guidance appears after a week of recorded prices.
- **Links.** Search results link to the Google Shopping listing. Direct store
  links appear once "Compare all stores" has run for a product.
- **Plans.** The project proposal notes that Supabase Free can pause an
  inactive project and keeps no automatic backups, and recommends Supabase Pro
  before a real launch. It also notes that Vercel Hobby is for personal,
  non-commercial use. Check both against the current terms.

## Commands

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:3000
npm test                     # 62 automated tests
npm run typecheck            # TypeScript only
npm run lint                 # ESLint
npm run build                # production build
```
