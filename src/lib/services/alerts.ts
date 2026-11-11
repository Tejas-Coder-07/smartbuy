import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { siteUrl } from "@/lib/config";
import { formatDateTime, formatINR } from "@/lib/domain/format";
import type { ListingRow } from "@/lib/domain/types";
import { comparableListings, isFresh, normaliseListing } from "./catalogue";
import { sendEmail } from "./email";

type AlertRow = {
  id: string;
  user_id: string;
  product_id: string;
  listing_id: string | null;
  target_price: number;
};

/**
 * Which listing, if any, satisfies an alert right now.
 * Only recently verified prices count; a stale price never triggers an alert.
 */
export function findTriggeringListing(
  alert: Pick<AlertRow, "listing_id" | "target_price">,
  listings: ListingRow[],
  now = new Date(),
): ListingRow | null {
  const target = Number(alert.target_price);
  const pool = alert.listing_id
    ? listings.filter((l) => l.id === alert.listing_id && l.current_price !== null)
    : comparableListings(listings);
  const hits = pool
    .filter((l) => isFresh(l, now) && (l.current_price ?? Infinity) <= target)
    .sort((a, b) => (a.current_price ?? 0) - (b.current_price ?? 0));
  return hits[0] ?? null;
}

/**
 * Checks every active alert on the given products against the latest
 * verified prices. A triggered alert creates an in-app notification, sends
 * an email, and is switched off until the user re-arms it.
 */
export async function evaluateAlerts(db: SupabaseClient, productIds: string[]): Promise<number> {
  if (productIds.length === 0) return 0;

  const { data: alertRows, error } = await db
    .from("price_alerts")
    .select("id, user_id, product_id, listing_id, target_price")
    .eq("status", "active")
    .in("product_id", productIds);
  if (error) throw new Error(`Could not read alerts: ${error.message}`);
  const alerts = (alertRows ?? []) as AlertRow[];
  if (alerts.length === 0) return 0;

  const alertProductIds = Array.from(new Set(alerts.map((a) => a.product_id)));
  const [{ data: listingRows, error: listingError }, { data: productRows }, { data: profileRows }] = await Promise.all([
    db.from("listings").select("*").in("product_id", alertProductIds),
    db.from("products").select("id, title").in("id", alertProductIds),
    db.from("profiles").select("id, email").in("id", Array.from(new Set(alerts.map((a) => a.user_id)))),
  ]);
  if (listingError) throw new Error(`Could not read listings: ${listingError.message}`);

  const listingsByProduct = new Map<string, ListingRow[]>();
  for (const raw of (listingRows ?? []) as ListingRow[]) {
    const l = normaliseListing(raw);
    listingsByProduct.set(l.product_id, [...(listingsByProduct.get(l.product_id) ?? []), l]);
  }
  const titles = new Map(((productRows ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));
  const emails = new Map(((profileRows ?? []) as { id: string; email: string | null }[]).map((p) => [p.id, p.email]));

  let triggered = 0;
  const now = new Date();

  for (const alert of alerts) {
    const hit = findTriggeringListing(alert, listingsByProduct.get(alert.product_id) ?? [], now);
    if (!hit || hit.current_price === null) continue;

    // Claim the alert first so two overlapping runs cannot both notify.
    const { data: claimed, error: claimError } = await db
      .from("price_alerts")
      .update({
        status: "triggered",
        triggered_at: now.toISOString(),
        triggered_price: hit.current_price,
        triggered_store: hit.store,
        updated_at: now.toISOString(),
      })
      .eq("id", alert.id)
      .eq("status", "active")
      .select("id");
    if (claimError || !claimed || claimed.length === 0) continue;

    const title = titles.get(alert.product_id) ?? "A product on your watchlist";
    const heading = `${title} is now ${formatINR(hit.current_price)}`;
    const body = `${hit.store} listed it at ${formatINR(hit.current_price)}, at or below your target of ${formatINR(Number(alert.target_price))}. Price checked ${formatDateTime(hit.last_observed_at)}.`;

    const { data: note, error: noteError } = await db
      .from("notifications")
      .insert({
        user_id: alert.user_id,
        alert_id: alert.id,
        product_id: alert.product_id,
        title: heading,
        body,
      })
      .select("id")
      .single();
    if (noteError) {
      console.error("[smartbuy] could not create notification:", noteError.message);
      continue;
    }
    triggered += 1;

    const to = emails.get(alert.user_id);
    const result = to
      ? await sendEmail({
          to,
          subject: `Price alert: ${title.slice(0, 80)} at ${formatINR(hit.current_price)}`,
          heading,
          lines: [body],
          action: { label: "View on SmartBuy", url: `${siteUrl()}/product/${alert.product_id}` },
        })
      : ({ status: "skipped", reason: "No email address on file" } as const);

    await db
      .from("notifications")
      .update({
        email_status: result.status,
        email_error: result.status === "failed" ? result.error : result.status === "skipped" ? result.reason : null,
      })
      .eq("id", note.id);
  }

  return triggered;
}
