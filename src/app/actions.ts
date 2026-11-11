"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getIsAdmin, getUser, isUuid, safeNextPath } from "@/lib/auth";
import { isServerConfigured, isSupabaseConfigured, siteUrl } from "@/lib/config";
import { formatINR } from "@/lib/domain/format";
import type { ListingRow, ProductRow } from "@/lib/domain/types";
import { getProvider, ProviderError } from "@/lib/providers";
import { evaluateAlerts } from "@/lib/services/alerts";
import { bestOffer, normaliseListing } from "@/lib/services/catalogue";
import { runCollection } from "@/lib/services/collect";
import { refreshOffers } from "@/lib/services/offers";
import { checkLiveBudget } from "@/lib/services/usage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; message: string } | null;

const NOT_CONNECTED: FormState = { ok: false, message: "SmartBuy is not connected to its database yet." };

async function origin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return siteUrl();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return siteUrl();
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONNECTED;
  const email = text(form, "email").toLowerCase();
  const password = text(form, "password");
  const fullName = text(form, "full_name").slice(0, 80);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, message: "Use a password of at least 8 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: fullName ? { full_name: fullName } : undefined,
      emailRedirectTo: `${await origin()}/auth/confirm?next=/dashboard`,
    },
  });
  if (error) return { ok: false, message: error.message };

  if (data.session) redirect("/dashboard");
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { ok: false, message: "An account with this email already exists. Sign in instead." };
  }
  return { ok: true, message: `We sent a confirmation link to ${email}. Open it to finish creating your account.` };
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONNECTED;
  const email = text(form, "email").toLowerCase();
  const password = text(form, "password");
  if (!email || !password) return { ok: false, message: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const unconfirmed = /not confirmed/i.test(error.message);
    return {
      ok: false,
      message: unconfirmed
        ? "Confirm your email first: open the link we sent when you signed up."
        : "That email and password do not match an account.",
    };
  }
  redirect(safeNextPath(form.get("next")));
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}

export async function requestPasswordReset(_prev: FormState, form: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONNECTED;
  const email = text(form, "email").toLowerCase();
  if (!email) return { ok: false, message: "Enter your email address." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await origin()}/auth/confirm?next=/update-password`,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: `If ${email} has an account, a reset link is on its way.` };
}

export async function updatePassword(_prev: FormState, form: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONNECTED;
  const password = text(form, "password");
  if (password.length < 8) return { ok: false, message: "Use a password of at least 8 characters." };
  const user = await getUser();
  if (!user) return { ok: false, message: "Open the reset link from your email again, then set a new password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: error.message };
  redirect("/dashboard");
}

// ---------------------------------------------------------------------------
// Watchlist and alerts
// ---------------------------------------------------------------------------

export async function toggleWatchlist(_prev: FormState, form: FormData): Promise<FormState> {
  const productId = text(form, "product_id");
  if (!isUuid(productId)) return { ok: false, message: "Unknown product." };
  const user = await getUser();
  if (!user) redirect(`/login?next=/product/${productId}`);

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("watchlist_items")
    .select("id")
    .eq("product_id", productId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("watchlist_items").delete().eq("id", existing.id);
    if (error) return { ok: false, message: "Could not remove this product from your watchlist." };
    refresh();
    return { ok: true, message: "Removed from your watchlist." };
  }

  const { error } = await supabase.from("watchlist_items").insert({ product_id: productId });
  if (error) return { ok: false, message: "Could not save this product to your watchlist." };
  refresh();
  return { ok: true, message: "Saved to your watchlist. SmartBuy will keep checking its price." };
}

export async function saveAlert(_prev: FormState, form: FormData): Promise<FormState> {
  const productId = text(form, "product_id");
  const listingId = text(form, "listing_id");
  const target = Number(text(form, "target_price").replace(/[₹,\s]/g, ""));

  if (!isUuid(productId)) return { ok: false, message: "Unknown product." };
  if (listingId && !isUuid(listingId)) return { ok: false, message: "Unknown store listing." };
  if (!Number.isFinite(target) || target <= 0) return { ok: false, message: "Enter a target price in rupees." };
  if (target > 100_000_000) return { ok: false, message: "That target price is too large." };

  const user = await getUser();
  if (!user) redirect(`/login?next=/product/${productId}`);

  const supabase = await createClient();
  const { data: listingRows, error: listingError } = await supabase.from("listings").select("*").eq("product_id", productId);
  if (listingError) return { ok: false, message: "Could not read this product's prices." };
  const listings = ((listingRows ?? []) as ListingRow[]).map(normaliseListing);
  if (listingId && !listings.some((l) => l.id === listingId)) {
    return { ok: false, message: "That store listing does not belong to this product." };
  }

  const pool = listingId ? listings.filter((l) => l.id === listingId) : listings;
  const best = bestOffer(pool.map((l) => (listingId ? { ...l, variant_match: "same" as const } : l)));
  if (best?.fresh && best.listing.current_price !== null && best.listing.current_price <= target) {
    return {
      ok: false,
      message: `${best.listing.store} already lists it at ${formatINR(best.listing.current_price)}, which is at or below ${formatINR(target)}. Choose a lower target.`,
    };
  }

  const { error } = await supabase.from("price_alerts").upsert(
    {
      user_id: user.id,
      product_id: productId,
      listing_id: listingId || null,
      target_price: target,
      status: "active",
      triggered_at: null,
      triggered_price: null,
      triggered_store: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,product_id" },
  );
  if (error) return { ok: false, message: "Could not save the alert." };

  // A product with an alert is tracked, so keep it on the watchlist too.
  await supabase.from("watchlist_items").upsert({ user_id: user.id, product_id: productId }, { onConflict: "user_id,product_id", ignoreDuplicates: true });

  refresh();
  return { ok: true, message: `Alert set. You will be told when the price reaches ${formatINR(target)} or lower.` };
}

export async function deleteAlert(form: FormData): Promise<void> {
  const alertId = text(form, "alert_id");
  if (!isUuid(alertId)) return;
  const user = await getUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  await supabase.from("price_alerts").delete().eq("id", alertId).eq("user_id", user.id);
  refresh();
}

export async function removeFromWatchlist(form: FormData): Promise<void> {
  const productId = text(form, "product_id");
  if (!isUuid(productId)) return;
  const user = await getUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  await supabase.from("watchlist_items").delete().eq("product_id", productId).eq("user_id", user.id);
  refresh();
}

export async function markNotificationsRead(): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
  refresh();
}

// ---------------------------------------------------------------------------
// Live price checks
// ---------------------------------------------------------------------------

export async function refreshProductPrices(_prev: FormState, form: FormData): Promise<FormState> {
  const productId = text(form, "product_id");
  if (!isUuid(productId)) return { ok: false, message: "Unknown product." };
  if (!isServerConfigured()) return NOT_CONNECTED;

  const user = await getUser();
  if (!user) redirect(`/login?next=/product/${productId}`);

  if (!getProvider().isConfigured()) {
    return { ok: false, message: "No product-data source is connected yet, so live prices cannot be fetched." };
  }

  const db = createAdminClient();
  const budget = await checkLiveBudget(db, user.id);
  if (!budget.ok) return { ok: false, message: budget.message };

  const { data: product, error } = await db
    .from("products")
    .select("id, title, variant, provider_product_id, provider_token")
    .eq("id", productId)
    .maybeSingle();
  if (error || !product) return { ok: false, message: "This product could not be found." };

  try {
    const result = await refreshOffers(
      db,
      product as Pick<ProductRow, "id" | "title" | "variant" | "provider_product_id" | "provider_token">,
      { userId: user.id },
    );
    await evaluateAlerts(db, [productId]);
    refresh();
    if (result.stores === 0) {
      return { ok: true, message: "The data source returned no store offers for this product right now." };
    }
    const storeWord = result.stores === 1 ? "store" : "stores";
    return { ok: true, message: `Checked ${result.stores} ${storeWord} and recorded ${result.observations} new price observation${result.observations === 1 ? "" : "s"}.` };
  } catch (err) {
    console.error("[smartbuy] price refresh failed:", err);
    return {
      ok: false,
      message: err instanceof ProviderError ? err.message : "Could not fetch live prices. Please try again.",
    };
  }
}

export async function runCollectionNow(_prev: FormState): Promise<FormState> {
  void _prev;
  if (!isServerConfigured()) return NOT_CONNECTED;
  if (!(await getIsAdmin())) return { ok: false, message: "Only an administrator can start a collection run." };

  try {
    const summary = await runCollection("manual");
    refresh();
    const parts = [
      `Run ${summary.status}`,
      `${summary.productsChecked} product(s) checked`,
      `${summary.observationsWritten} observation(s) recorded`,
      `${summary.alertsTriggered} alert(s) triggered`,
    ];
    if (summary.failures > 0) parts.push(`${summary.failures} failure(s)`);
    return { ok: summary.status !== "failed", message: `${parts.join(", ")}.${summary.note ? ` ${summary.note}` : ""}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "The collection run failed to start." };
  }
}
