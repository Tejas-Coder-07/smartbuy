import { randomUUID } from "node:crypto";

/**
 * A small in-memory stand-in for the parts of the Supabase query builder the
 * services use. It exists so the price pipeline (ingest, history, alerts,
 * collection) can be tested end to end without a network. It is test-only
 * code and holds test-only rows.
 */
type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const UNIQUE: Record<string, string[][]> = {
  products: [["id"], ["match_key"]],
  listings: [["id"], ["product_id", "store_key", "variant_key"]],
  search_cache: [["query_key"]],
  watchlist_items: [["id"], ["user_id", "product_id"]],
  price_alerts: [["id"], ["user_id", "product_id"]],
};

const DEFAULTS: Record<string, () => Row> = {
  products: () => ({ id: randomUUID(), offers_refreshed_at: null, created_at: now(), updated_at: now() }),
  listings: () => ({ id: randomUUID(), last_observed_at: null, created_at: now() }),
  price_observations: () => ({ id: counter(), observed_at: now() }),
  collection_runs: () => ({ id: randomUUID(), status: "running", started_at: now(), error_log: [] }),
  provider_calls: () => ({ id: counter(), created_at: now() }),
  searches: () => ({ id: counter(), created_at: now() }),
  search_cache: () => ({ fetched_at: now() }),
  watchlist_items: () => ({ id: randomUUID(), created_at: now() }),
  price_alerts: () => ({ id: randomUUID(), status: "active", created_at: now() }),
  notifications: () => ({ id: randomUUID(), read_at: null, email_status: "pending", created_at: now() }),
  profiles: () => ({ created_at: now() }),
};

let seq = 0;
function counter(): number {
  seq += 1;
  return seq;
}
function now(): string {
  return new Date().toISOString();
}

export class FakeDb {
  tables: Record<string, Row[]> = {};

  table(name: string): Row[] {
    this.tables[name] ??= [];
    return this.tables[name];
  }

  from(name: string): Query {
    return new Query(this, name);
  }
}

class Query implements PromiseLike<{ data: unknown; error: null | { message: string }; count?: number }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private payload: Row[] = [];
  private changes: Row = {};
  private conflict: string[] = [];
  private ignoreDuplicates = false;
  private returning = false;
  private head = false;
  private wantCount = false;
  private embedListings = false;
  private orderBy: { col: string; asc: boolean; nullsFirst: boolean } | null = null;
  private max: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";

  constructor(
    private db: FakeDb,
    private name: string,
  ) {}

  select(cols = "*", opts: { count?: string; head?: boolean } = {}) {
    if (this.op === "select") {
      this.head = Boolean(opts.head);
      this.wantCount = Boolean(opts.count);
      this.embedListings = cols.includes("listings(");
    }
    this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflict = (opts.onConflict ?? UNIQUE[this.name]?.[0]?.join(",") ?? "id").split(",").map((c) => c.trim());
    this.ignoreDuplicates = Boolean(opts.ignoreDuplicates);
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.changes = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  is(col: string, value: null) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  gte(col: string, value: string) {
    this.filters.push((r) => String(r[col]) >= value);
    return this;
  }
  order(col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.orderBy = { col, asc: opts.ascending ?? true, nullsFirst: opts.nullsFirst ?? false };
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private violates(row: Row, self?: Row): boolean {
    return (UNIQUE[this.name] ?? []).some((cols) =>
      this.db.table(this.name).some((other) => other !== self && cols.every((c) => other[c] === row[c])),
    );
  }

  private run(): { data: unknown; error: null | { message: string }; count?: number } {
    const rows = this.db.table(this.name);
    const match = (r: Row) => this.filters.every((f) => f(r));
    let out: Row[] = [];

    if (this.op === "insert") {
      for (const p of this.payload) {
        const row = { ...(DEFAULTS[this.name]?.() ?? {}), ...p };
        if (this.violates(row)) return { data: null, error: { message: `duplicate key in ${this.name}` } };
        rows.push(row);
        out.push(row);
      }
    } else if (this.op === "upsert") {
      for (const p of this.payload) {
        const existing = rows.find((r) => this.conflict.every((c) => r[c] === p[c]));
        if (existing) {
          if (this.ignoreDuplicates) continue;
          const merged = { ...existing, ...p };
          if (this.violates(merged, existing)) return { data: null, error: { message: `duplicate key in ${this.name}` } };
          Object.assign(existing, p);
          out.push(existing);
        } else {
          const row = { ...(DEFAULTS[this.name]?.() ?? {}), ...p };
          if (this.violates(row)) return { data: null, error: { message: `duplicate key in ${this.name}` } };
          rows.push(row);
          out.push(row);
        }
      }
    } else if (this.op === "update") {
      out = rows.filter(match);
      out.forEach((r) => Object.assign(r, this.changes));
    } else if (this.op === "delete") {
      out = rows.filter(match);
      this.db.tables[this.name] = rows.filter((r) => !match(r));
    } else {
      out = rows.filter(match);
      if (this.orderBy) {
        const { col, asc, nullsFirst } = this.orderBy;
        out = [...out].sort((a, b) => {
          const av = a[col] ?? null;
          const bv = b[col] ?? null;
          if (av === null && bv === null) return 0;
          if (av === null) return nullsFirst ? -1 : 1;
          if (bv === null) return nullsFirst ? 1 : -1;
          return (av < bv ? -1 : av > bv ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      const count = out.length;
      if (this.max !== null) out = out.slice(0, this.max);
      if (this.embedListings) {
        out = out.map((p) => ({ ...p, listings: this.db.table("listings").filter((l) => l.product_id === p.id) }));
      }
      if (this.head) return { data: null, error: null, count };
      if (this.mode !== "many") {
        if (out.length === 0 && this.mode === "single") return { data: null, error: { message: "no rows" } };
        return { data: out[0] ?? null, error: null, count: this.wantCount ? count : undefined };
      }
      return { data: out.map((r) => ({ ...r })), error: null, count: this.wantCount ? count : undefined };
    }

    if (!this.returning) return { data: null, error: null };
    if (this.mode !== "many") return { data: out[0] ? { ...out[0] } : null, error: out[0] || this.mode === "maybe" ? null : { message: "no rows" } };
    return { data: out.map((r) => ({ ...r })), error: null };
  }

  then<A, B>(
    resolve?: ((value: { data: unknown; error: null | { message: string }; count?: number }) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(resolve, reject);
  }
}
