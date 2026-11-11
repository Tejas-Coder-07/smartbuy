import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { settings } from "@/lib/config";
import { ProviderError } from "@/lib/providers/types";

export type CallContext = {
  provider: string;
  kind: "search" | "offers";
  userId?: string | null;
  runId?: string | null;
};

/** Runs one data-source call, timing it and recording the outcome. */
export async function trackedCall<T>(db: SupabaseClient, ctx: CallContext, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    await record(db, ctx, { ok: true, durationMs: Date.now() - started });
    return result;
  } catch (err) {
    const status = err instanceof ProviderError ? err.status : undefined;
    const message = err instanceof Error ? err.message : String(err);
    await record(db, ctx, { ok: false, durationMs: Date.now() - started, status, error: message });
    throw err;
  }
}

async function record(
  db: SupabaseClient,
  ctx: CallContext,
  outcome: { ok: boolean; durationMs: number; status?: number; error?: string },
) {
  const { error } = await db.from("provider_calls").insert({
    provider: ctx.provider,
    kind: ctx.kind,
    ok: outcome.ok,
    status_code: outcome.status ?? null,
    error: outcome.error?.slice(0, 500) ?? null,
    duration_ms: outcome.durationMs,
    user_id: ctx.userId ?? null,
    run_id: ctx.runId ?? null,
  });
  if (error) console.error("[smartbuy] could not record provider call:", error.message);
}

function startOfMonthUtc(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Successful data-source calls this calendar month (what the source bills for). */
export async function monthlyCalls(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from("provider_calls")
    .select("id", { count: "exact", head: true })
    .eq("ok", true)
    .gte("created_at", startOfMonthUtc());
  if (error) throw new Error(`Could not read usage: ${error.message}`);
  return count ?? 0;
}

export async function userDailyCalls(db: SupabaseClient, userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from("provider_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) throw new Error(`Could not read usage: ${error.message}`);
  return count ?? 0;
}

export type BudgetCheck =
  | { ok: true; remainingThisMonth: number }
  | { ok: false; reason: "monthly_limit" | "user_limit"; message: string };

/** Decides whether one more live data-source call is allowed right now. */
export async function checkLiveBudget(db: SupabaseClient, userId: string | null): Promise<BudgetCheck> {
  const limit = settings.providerMonthlyLimit();
  const used = await monthlyCalls(db);
  if (used >= limit) {
    return {
      ok: false,
      reason: "monthly_limit",
      message: `This month's live price lookups are used up (${used} of ${limit}). Saved prices are still shown.`,
    };
  }
  if (userId) {
    const perUser = settings.userDailyLiveLimit();
    const mine = await userDailyCalls(db, userId);
    if (mine >= perUser) {
      return {
        ok: false,
        reason: "user_limit",
        message: `You have used today's ${perUser} live price lookups. Saved prices are still shown; try again tomorrow.`,
      };
    }
  }
  return { ok: true, remainingThisMonth: limit - used };
}
