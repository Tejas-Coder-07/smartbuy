import "server-only";
import { isServerConfigured, settings } from "@/lib/config";
import type { ProductRow } from "@/lib/domain/types";
import { getProvider } from "@/lib/providers";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateAlerts } from "./alerts";
import { refreshOffers } from "./offers";
import { monthlyCalls } from "./usage";

export type CollectionSummary = {
  runId: string | null;
  status: "success" | "partial" | "failed" | "skipped";
  productsChecked: number;
  observationsWritten: number;
  alertsTriggered: number;
  failures: number;
  note?: string;
};

const OVERLAP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Scheduled price collection.
 *
 * Refreshes the tracked products (anything on a watchlist or with an active
 * alert) that were checked longest ago, within the data source's allowance,
 * then evaluates price alerts against the fresh prices.
 */
export async function runCollection(trigger: "cron" | "manual"): Promise<CollectionSummary> {
  if (!isServerConfigured()) {
    return { runId: null, status: "skipped", productsChecked: 0, observationsWritten: 0, alertsTriggered: 0, failures: 0, note: "Database is not configured." };
  }

  const db = createAdminClient();
  const provider = getProvider();

  const overlapSince = new Date(Date.now() - OVERLAP_WINDOW_MS).toISOString();
  const { data: running } = await db.from("collection_runs").select("id").eq("status", "running").gte("started_at", overlapSince).limit(1);
  if (running && running.length > 0) {
    return { runId: null, status: "skipped", productsChecked: 0, observationsWritten: 0, alertsTriggered: 0, failures: 0, note: "Another collection run is in progress." };
  }

  const { data: run, error: runError } = await db.from("collection_runs").insert({ trigger }).select("id").single();
  if (runError || !run) throw new Error(`Could not start a collection run: ${runError?.message ?? "unknown error"}`);
  const runId = run.id as string;

  const finish = async (summary: Omit<CollectionSummary, "runId">, errorLog: unknown[] = []): Promise<CollectionSummary> => {
    await db
      .from("collection_runs")
      .update({
        status: summary.status,
        finished_at: new Date().toISOString(),
        products_checked: summary.productsChecked,
        observations_written: summary.observationsWritten,
        alerts_triggered: summary.alertsTriggered,
        failures: summary.failures,
        note: summary.note ?? null,
        error_log: errorLog,
      })
      .eq("id", runId);
    return { runId, ...summary };
  };

  try {
    if (!provider.isConfigured()) {
      return await finish({ status: "skipped", productsChecked: 0, observationsWritten: 0, alertsTriggered: 0, failures: 0, note: "No product-data source is connected." });
    }

    const [{ data: watched }, { data: alerted }] = await Promise.all([
      db.from("watchlist_items").select("product_id"),
      db.from("price_alerts").select("product_id").eq("status", "active"),
    ]);
    const trackedIds = Array.from(
      new Set([...(watched ?? []), ...(alerted ?? [])].map((r) => (r as { product_id: string }).product_id)),
    );
    if (trackedIds.length === 0) {
      return await finish({ status: "success", productsChecked: 0, observationsWritten: 0, alertsTriggered: 0, failures: 0, note: "No tracked products yet." });
    }

    const used = await monthlyCalls(db);
    const remaining = Math.max(0, settings.providerMonthlyLimit() - used);
    const batch = Math.min(settings.collectMaxProducts(), remaining);
    if (batch === 0) {
      return await finish({ status: "skipped", productsChecked: 0, observationsWritten: 0, alertsTriggered: 0, failures: 0, note: "Monthly data-source allowance is used up." });
    }

    const { data: productRows, error: productError } = await db
      .from("products")
      .select("id, title, variant, provider_product_id, provider_token, offers_refreshed_at")
      .in("id", trackedIds)
      .order("offers_refreshed_at", { ascending: true, nullsFirst: true })
      .limit(batch);
    if (productError) throw new Error(`Could not read tracked products: ${productError.message}`);
    const products = (productRows ?? []) as Pick<ProductRow, "id" | "title" | "variant" | "provider_product_id" | "provider_token">[];

    let observations = 0;
    const errors: { product_id: string; title: string; error: string }[] = [];
    const checked: string[] = [];

    for (const product of products) {
      try {
        const result = await refreshOffers(db, product, { runId });
        observations += result.observations;
        checked.push(product.id);
      } catch (err) {
        errors.push({
          product_id: product.id,
          title: product.title.slice(0, 120),
          error: err instanceof Error ? err.message.slice(0, 300) : String(err),
        });
      }
    }

    let alertsTriggered = 0;
    try {
      alertsTriggered = await evaluateAlerts(db, checked);
    } catch (err) {
      errors.push({ product_id: "-", title: "Alert evaluation", error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
    }

    const status = errors.length === 0 ? "success" : checked.length > 0 ? "partial" : "failed";
    const waiting = trackedIds.length - products.length;
    return await finish(
      {
        status,
        productsChecked: checked.length,
        observationsWritten: observations,
        alertsTriggered,
        failures: errors.length,
        note: waiting > 0 ? `${waiting} tracked product(s) wait for a later run.` : undefined,
      },
      errors,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return await finish(
      { status: "failed", productsChecked: 0, observationsWritten: 0, alertsTriggered: 0, failures: 1, note: message.slice(0, 300) },
      [{ product_id: "-", title: "Run", error: message.slice(0, 300) }],
    );
  }
}
