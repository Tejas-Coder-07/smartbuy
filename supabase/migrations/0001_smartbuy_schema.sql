-- SmartBuy schema
-- Run once in the Supabase SQL editor (or with `supabase db push`).
-- Every table has row-level security. Catalogue and price data is public
-- read-only; all writes to it come from the server using the secret key.

-- ---------------------------------------------------------------------------
-- Admins: anyone whose confirmed login email is listed here sees /admin.
-- ---------------------------------------------------------------------------
create table public.admin_emails (
  email text primary key
);

-- Replace with the email address you will sign up with, before running this.
insert into public.admin_emails (email) values ('admin@example.com');

-- ---------------------------------------------------------------------------
-- Profiles (one per auth user)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.admin_emails a on lower(a.email) = lower(u.email)
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
  );
$$;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  match_key text not null unique,
  title text not null,
  brand text,
  model text,
  category text not null default 'other',
  variant jsonb not null default '{}'::jsonb,
  image_url text,
  provider text not null,
  provider_product_id text,
  provider_token text,
  rating numeric(3, 2),
  review_count integer,
  offers_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_idx on public.products (category);
create index products_offers_refreshed_idx on public.products (offers_refreshed_at nulls first);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

-- One row per (product, store, variant) offer.
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  store text not null,
  store_key text not null,
  variant_key text not null default '',
  variant jsonb not null default '{}'::jsonb,
  variant_match text not null default 'unknown'
    check (variant_match in ('same', 'different', 'unknown')),
  title text not null,
  url text,
  current_price numeric(12, 2) check (current_price is null or current_price > 0),
  mrp numeric(12, 2),
  shipping text,
  detail text,
  provider text not null,
  last_observed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (product_id, store_key, variant_key)
);

create index listings_product_idx on public.listings (product_id);
create index listings_store_idx on public.listings (store_key);
create index listings_last_observed_idx on public.listings (last_observed_at);

-- ---------------------------------------------------------------------------
-- Collection runs and provider usage
-- ---------------------------------------------------------------------------
create table public.collection_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'cron' check (trigger in ('cron', 'manual')),
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  products_checked integer not null default 0,
  observations_written integer not null default 0,
  alerts_triggered integer not null default 0,
  failures integer not null default 0,
  note text,
  error_log jsonb not null default '[]'::jsonb
);

create index collection_runs_started_idx on public.collection_runs (started_at desc);

create table public.provider_calls (
  id bigint generated always as identity primary key,
  provider text not null,
  kind text not null check (kind in ('search', 'offers')),
  ok boolean not null,
  status_code integer,
  error text,
  duration_ms integer,
  user_id uuid references auth.users (id) on delete set null,
  run_id uuid references public.collection_runs (id) on delete set null,
  created_at timestamptz not null default now()
);

create index provider_calls_created_idx on public.provider_calls (created_at desc);
create index provider_calls_user_idx on public.provider_calls (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Price history: timestamped observations, never edited after insert.
-- ---------------------------------------------------------------------------
create table public.price_observations (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  price numeric(12, 2) not null check (price > 0),
  mrp numeric(12, 2),
  currency text not null default 'INR',
  observed_at timestamptz not null default now(),
  provider text not null,
  run_id uuid references public.collection_runs (id) on delete set null
);

create index price_observations_listing_idx
  on public.price_observations (listing_id, observed_at desc);
create index price_observations_product_idx
  on public.price_observations (product_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- Search activity and cache
-- ---------------------------------------------------------------------------
create table public.search_cache (
  query_key text primary key,
  provider text not null,
  product_ids uuid[] not null default '{}',
  fetched_at timestamptz not null default now()
);

create table public.searches (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  query text not null,
  parsed jsonb not null default '{}'::jsonb,
  result_count integer not null default 0,
  from_cache boolean not null default false,
  created_at timestamptz not null default now()
);

create index searches_user_idx on public.searches (user_id, created_at desc);
create index searches_created_idx on public.searches (created_at desc);

-- ---------------------------------------------------------------------------
-- Watchlist, alerts and notifications
-- ---------------------------------------------------------------------------
create table public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index watchlist_product_idx on public.watchlist_items (product_id);

create table public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  listing_id uuid references public.listings (id) on delete set null,
  target_price numeric(12, 2) not null check (target_price > 0),
  status text not null default 'active' check (status in ('active', 'triggered', 'paused')),
  triggered_at timestamptz,
  triggered_price numeric(12, 2),
  triggered_store text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index price_alerts_product_idx on public.price_alerts (product_id) where status = 'active';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  alert_id uuid references public.price_alerts (id) on delete set null,
  product_id uuid references public.products (id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  email_status text not null default 'pending'
    check (email_status in ('pending', 'sent', 'failed', 'skipped')),
  email_error text,
  created_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Admin overview (single call for the admin dashboard counters)
-- ---------------------------------------------------------------------------
create function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'users_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'products', (select count(*) from public.products),
    'listings', (select count(*) from public.listings),
    'observations', (select count(*) from public.price_observations),
    'observations_24h', (select count(*) from public.price_observations where observed_at > now() - interval '24 hours'),
    'first_observation_at', (select min(observed_at) from public.price_observations),
    'searches_7d', (select count(*) from public.searches where created_at > now() - interval '7 days'),
    'searches_total', (select count(*) from public.searches),
    'watchlist_items', (select count(*) from public.watchlist_items),
    'active_alerts', (select count(*) from public.price_alerts where status = 'active'),
    'triggered_alerts', (select count(*) from public.price_alerts where status = 'triggered'),
    'tracked_products', (
      select count(*) from (
        select product_id from public.watchlist_items
        union
        select product_id from public.price_alerts where status = 'active'
      ) t
    ),
    'listings_fresh_24h', (select count(*) from public.listings where last_observed_at > now() - interval '24 hours'),
    'listings_1_to_7d', (select count(*) from public.listings where last_observed_at <= now() - interval '24 hours' and last_observed_at > now() - interval '7 days'),
    'listings_stale_7d', (select count(*) from public.listings where last_observed_at is null or last_observed_at <= now() - interval '7 days'),
    'provider_calls_month', (select count(*) from public.provider_calls where ok and created_at >= date_trunc('month', now())),
    'provider_failures_7d', (select count(*) from public.provider_calls where not ok and created_at > now() - interval '7 days'),
    'last_provider_success_at', (select max(created_at) from public.provider_calls where ok),
    'last_provider_failure_at', (select max(created_at) from public.provider_calls where not ok),
    'emails_failed_7d', (select count(*) from public.notifications where email_status = 'failed' and created_at > now() - interval '7 days'),
    'database_bytes', pg_database_size(current_database())
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.admin_emails enable row level security;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.listings enable row level security;
alter table public.price_observations enable row level security;
alter table public.collection_runs enable row level security;
alter table public.provider_calls enable row level security;
alter table public.search_cache enable row level security;
alter table public.searches enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.price_alerts enable row level security;
alter table public.notifications enable row level security;

-- Public, read-only catalogue and price history.
create policy "catalogue is public" on public.products
  for select to anon, authenticated using (true);
create policy "listings are public" on public.listings
  for select to anon, authenticated using (true);
create policy "price history is public" on public.price_observations
  for select to anon, authenticated using (true);

-- Profiles: own row, admins see all.
create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Search log: own rows, admins see all. Inserts come from the server.
create policy "read own searches" on public.searches
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Watchlist: fully owned by the user.
create policy "read own watchlist" on public.watchlist_items
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "add to own watchlist" on public.watchlist_items
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "remove from own watchlist" on public.watchlist_items
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Alerts: fully owned by the user.
create policy "read own alerts" on public.price_alerts
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "create own alerts" on public.price_alerts
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "update own alerts" on public.price_alerts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "delete own alerts" on public.price_alerts
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Notifications: read and mark as read.
create policy "read own notifications" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "mark own notifications" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Operations data: admins only.
create policy "admins read runs" on public.collection_runs
  for select to authenticated using ((select public.is_admin()));
create policy "admins read provider calls" on public.provider_calls
  for select to authenticated using ((select public.is_admin()));

-- admin_emails and search_cache have no policies: server (secret key) only.

-- ---------------------------------------------------------------------------
-- Privileges (explicit, so the Data API exposes exactly this)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.products, public.listings, public.price_observations to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant select on public.searches, public.collection_runs, public.provider_calls to authenticated;
grant select, insert, delete on public.watchlist_items to authenticated;
grant select, insert, update, delete on public.price_alerts to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
