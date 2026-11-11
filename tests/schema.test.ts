import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the real migration against an in-process Postgres (PGlite) with a
 * minimal stand-in for Supabase's auth schema and roles, then checks that
 * row-level security behaves as intended.
 */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
`;

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";
const ADMIN = "00000000-0000-0000-0000-0000000000ad";

let db: PGlite;

async function as<T>(role: string, uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const sql = readFileSync(
    join(__dirname, "..", "supabase", "migrations", "0001_smartbuy_schema.sql"),
    "utf8",
  );
  await db.exec(sql);

  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
      ('${ALICE}', 'alice@example.com', now(), '{"full_name":"Alice"}'),
      ('${BOB}', 'bob@example.com', now(), '{}'),
      ('${ADMIN}', 'Admin@Example.com', now(), '{}');
    insert into public.products (id, match_key, title, provider)
      values ('11111111-1111-1111-1111-111111111111', 'gp:1', 'Test product', 'test');
    insert into public.listings (id, product_id, store, store_key, title, provider, current_price)
      values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Croma', 'croma', 'Test product', 'test', 100);
    insert into public.price_observations (listing_id, product_id, price, provider)
      values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 100, 'test');
    insert into public.searches (user_id, query) values ('${ALICE}', 'alice search'), ('${BOB}', 'bob search');
    insert into public.collection_runs (status) values ('success');
  `);
}, 60_000);

describe("schema", () => {
  it("creates a profile for every new auth user", async () => {
    const r = await db.query<{ email: string; full_name: string | null }>(
      `select email, full_name from public.profiles order by email`,
    );
    expect(r.rows).toHaveLength(3);
    expect(r.rows.find((p) => p.email === "alice@example.com")?.full_name).toBe("Alice");
  });

  it("rejects non-positive prices", async () => {
    await expect(
      db.exec(`insert into public.price_observations (listing_id, product_id, price, provider)
        values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 0, 'test')`),
    ).rejects.toThrow();
  });
});

describe("row-level security", () => {
  it("lets anonymous visitors read the catalogue and price history but not write", async () => {
    await as("anon", null, async () => {
      const p = await db.query(`select id from public.products`);
      const o = await db.query(`select id from public.price_observations`);
      expect(p.rows).toHaveLength(1);
      expect(o.rows).toHaveLength(1);
      await expect(
        db.exec(`insert into public.products (match_key, title, provider) values ('x', 'x', 'x')`),
      ).rejects.toThrow();
      await expect(db.exec(`update public.listings set current_price = 1`)).rejects.toThrow();
      await expect(db.query(`select * from public.searches`)).rejects.toThrow();
      await expect(db.query(`select * from public.admin_emails`)).rejects.toThrow();
    });
  });

  it("keeps watchlists, alerts and searches private to their owner", async () => {
    await as("authenticated", ALICE, async () => {
      await db.exec(`insert into public.watchlist_items (product_id) values ('11111111-1111-1111-1111-111111111111')`);
      await db.exec(`insert into public.price_alerts (product_id, target_price) values ('11111111-1111-1111-1111-111111111111', 90)`);
      const s = await db.query<{ query: string }>(`select query from public.searches`);
      expect(s.rows.map((r) => r.query)).toEqual(["alice search"]);
    });

    await as("authenticated", BOB, async () => {
      const w = await db.query(`select id from public.watchlist_items`);
      const a = await db.query(`select id from public.price_alerts`);
      expect(w.rows).toHaveLength(0);
      expect(a.rows).toHaveLength(0);
      // Bob cannot add rows on Alice's behalf.
      await expect(
        db.exec(`insert into public.watchlist_items (user_id, product_id) values ('${ALICE}', '11111111-1111-1111-1111-111111111111')`),
      ).rejects.toThrow();
      // Bob's update of Alice's alert touches nothing.
      await db.exec(`update public.price_alerts set target_price = 1`);
    });

    const check = await db.query<{ target_price: string }>(`select target_price from public.price_alerts`);
    expect(Number(check.rows[0].target_price)).toBe(90);
  });

  it("limits what users can change on their own rows", async () => {
    await as("authenticated", ALICE, async () => {
      await db.exec(`update public.profiles set full_name = 'Alice B' where id = '${ALICE}'`);
      await expect(
        db.exec(`update public.profiles set email = 'evil@example.com' where id = '${ALICE}'`),
      ).rejects.toThrow();
    });
  });

  it("gives operations data to admins only", async () => {
    await as("authenticated", ALICE, async () => {
      const admin = await db.query<{ is_admin: boolean }>(`select public.is_admin() as is_admin`);
      expect(admin.rows[0].is_admin).toBe(false);
      const runs = await db.query(`select id from public.collection_runs`);
      expect(runs.rows).toHaveLength(0);
      await expect(db.query(`select public.admin_overview()`)).rejects.toThrow(/not authorised/);
    });

    await as("authenticated", ADMIN, async () => {
      const admin = await db.query<{ is_admin: boolean }>(`select public.is_admin() as is_admin`);
      expect(admin.rows[0].is_admin).toBe(true);
      const runs = await db.query(`select id from public.collection_runs`);
      expect(runs.rows).toHaveLength(1);
      const all = await db.query(`select id from public.searches`);
      expect(all.rows).toHaveLength(2);
      const o = await db.query<{ admin_overview: Record<string, unknown> }>(`select public.admin_overview()`);
      expect(o.rows[0].admin_overview.users).toBe(3);
      expect(o.rows[0].admin_overview.tracked_products).toBe(1);
    });
  });

  it("does not treat an unconfirmed admin email as an admin", async () => {
    await db.exec(`update auth.users set email_confirmed_at = null where id = '${ADMIN}'`);
    await as("authenticated", ADMIN, async () => {
      const admin = await db.query<{ is_admin: boolean }>(`select public.is_admin() as is_admin`);
      expect(admin.rows[0].is_admin).toBe(false);
    });
    await db.exec(`update auth.users set email_confirmed_at = now() where id = '${ADMIN}'`);
  });
});
