import type { NextRequest } from "next/server";
import { cronSecret } from "@/lib/config";
import { runCollection } from "@/lib/services/collect";

export const maxDuration = 300;

/**
 * Scheduled price collection. Vercel Cron calls this once a day (see
 * vercel.json) and sends `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: NextRequest) {
  const secret = cronSecret();
  const header = request.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const summary = await runCollection("cron");
    return Response.json(summary, { status: summary.status === "failed" ? 500 : 200 });
  } catch (err) {
    console.error("[smartbuy] scheduled collection failed:", err);
    return Response.json({ status: "failed", error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
