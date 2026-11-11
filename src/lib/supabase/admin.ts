import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "@/lib/config";

/**
 * Server-only Supabase client that uses the secret key and therefore bypasses
 * row-level security. It writes catalogue data, price observations,
 * notifications and operations logs. Never import this from a Client
 * Component and never pass its results to the browser unfiltered.
 */
export function createAdminClient(): SupabaseClient {
  const url = supabaseUrl();
  const key = supabaseSecretKey();
  if (!url || !key) {
    throw new Error("Supabase is not fully configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
