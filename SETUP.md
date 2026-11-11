# SmartBuy setup

Use one project Gmail address for every service below.

The app runs without any of this, but it shows a "not connected yet" notice
until steps 1 and 2 are done.

## What you need to create

| # | Service | Why | Cost |
|---|---------|-----|------|
| 1 | Supabase project | Database and sign-in | Free plan to start |
| 2 | SerpApi account | Real product prices (Google Shopping, India) | Free plan: 250 searches a month |
| 3 | Google app password | Sending alert emails from the Gmail address | Free |
| 4 | GitHub repository | Holds the source code | Free |
| 5 | Vercel project | Hosting and the daily price-collection job | Hobby plan to start |

## 1. Supabase

1. Sign up at <https://supabase.com> with the Gmail address and create a new
   project. Pick the region closest to your users (Mumbai, `ap-south-1`).
2. Open **SQL Editor**, paste the whole of
   `supabase/migrations/0001_smartbuy_schema.sql`, and run it once. It creates
   every table and the access rules. Before running it, change
   `admin@example.com` near the top to the email address you will sign up with;
   that address becomes the administrator.
3. Open **Connect** (or **Settings > API Keys**) and copy three values:
   - Project URL -> `NEXT_PUBLIC_SUPABASE_URL`
   - Publishable key (`sb_publishable_...`) -> `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - Secret key (`sb_secret_...`) -> `SUPABASE_SECRET_KEY`
4. Open **Authentication > URL Configuration**:
   - Site URL: your app's address (for example `https://smartbuy.vercel.app`)
   - Redirect URLs: add `https://YOUR-APP-ADDRESS/auth/confirm` and, for local
     work, `http://localhost:3000/auth/confirm`
5. Leave **Confirm email** switched on (Authentication > Sign In / Providers >
   Email). The administrator check relies on confirmed email addresses.

Supabase's built-in email sender is meant for testing and only sends a few
emails an hour. Before inviting many people, set **Authentication > Emails >
SMTP Settings** to Gmail (`smtp.gmail.com`, port 465, the Gmail address, and
the app password from step 3).

## 2. SerpApi (the product-data source)

1. Sign up at <https://serpapi.com> with the Gmail address.
2. Copy the API key from the dashboard -> `SERPAPI_API_KEY`.

How the monthly allowance is spent:

| Action | Lookups |
|--------|---------|
| A search nobody has run in the last 12 hours | 1 |
| "Compare all stores" on a product | 1 |
| Daily collection, per tracked product | 1 |

With the defaults (6 tracked products refreshed per day) the daily job uses
about 180 lookups a month and leaves about 70 for searches. Change
`COLLECT_MAX_PRODUCTS`, `USER_DAILY_LIVE_LIMIT` and `PROVIDER_MONTHLY_LIMIT`
to rebalance, or move to a paid SerpApi plan when the club needs more.

## 3. Gmail app password (alert emails)

1. Sign in to the Gmail account, open <https://myaccount.google.com/security>
   and switch on **2-Step Verification**.
2. Open <https://myaccount.google.com/apppasswords>, create an app password
   named "SmartBuy", and copy the 16 characters -> `GMAIL_APP_PASSWORD`.
3. `GMAIL_USER` is the Gmail address; `EMAIL_FROM_NAME` is the sender name shown on alert emails.

Without these two values alerts still appear on the dashboard; only the email
is skipped.

## 4. GitHub and Vercel

1. Create a GitHub account with the Gmail address, create an empty repository
   named `smartbuy`, and push this folder to it.
2. Sign up at <https://vercel.com> with the same GitHub account and import the
   repository.
3. In **Project > Settings > Environment Variables** add every name from
   `.env.example` with its value. For `CRON_SECRET` use any long random string.
   Set `NEXT_PUBLIC_SITE_URL` to the app's address.
4. Deploy. **Redeploy whenever you change an environment variable**; the app
   reads them when it is built.

`vercel.json` schedules `/api/cron/collect` once a day at 7:00 am IST. That is
the job that keeps price history growing and fires alerts.

Your proposal notes that Vercel's Hobby plan is for personal, non-commercial
use. Check that against Vercel's current terms before any commercial launch.

## 5. First run

1. Open the app, choose **Create account**, and sign up with the administrator
   email address. Confirm through the email link.
2. An **Admin** link appears in the header. The admin page shows whether the
   data source, database writes, email and the scheduled job are connected.
3. Search for a product. The first search is a live lookup; open a result and
   choose **Compare all stores**, then **Save to watchlist** and set an alert.
4. On the admin page, **Run price collection now** runs the daily job once so
   you can see it work without waiting for 7:00 am.

To add another administrator, run this in the Supabase SQL editor:

```sql
insert into public.admin_emails (email) values ('someone@example.com');
```

## Running it on your own computer

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:3000
npm test                     # 62 automated tests
```

## Things to know

- **Where prices come from.** SmartBuy reads Google Shopping results for India
  through SerpApi, a paid third-party data service. It is not an API approved
  by Amazon, Flipkart, Myntra, AJIO, Croma or Reliance Digital, and a store
  appears only when Google Shopping lists its offer. The code has a provider
  interface (`src/lib/providers/`), so an approved retailer or affiliate API
  can be added later without changing search, history or alerts.
- **History starts on day one.** A product has no price history until SmartBuy
  first checks it. Buying guidance appears after a week of recorded prices.
- **Links.** Search results link to the Google Shopping listing. Direct store
  links appear once "Compare all stores" has run for a product.
- **Variants.** Offers that state a different storage size, colour or size from
  the product are listed separately and never used for the lowest price,
  history or alerts. Offers that state no variant at all are compared.
- **Not yet run against live services.** The automated tests cover the database
  rules on a real Postgres engine and the whole price pipeline with stand-ins
  for SerpApi, Supabase's API and Gmail. The first run with your real keys is
  the first live test; the admin page reports any failed lookup with its error.
