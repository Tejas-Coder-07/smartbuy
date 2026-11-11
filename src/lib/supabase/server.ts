import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { supabasePublishableKey, supabaseUrl } from "@/lib/config";

/**
 * Supabase client that acts as the signed-in visitor (or as an anonymous
 * visitor). Row-level security decides what it can read and write.
 */
export async function createClient() {
  // Sessions are per request: never let a session read run during a prerender
  // or a prefetch (the auth library also reads the clock).
  await connection();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl()!, supabasePublishableKey()!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The proxy refreshes the session cookie on every request instead.
        }
      },
    },
  });
}
