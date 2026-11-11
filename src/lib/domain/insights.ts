import { formatDate, formatINR } from "./format";
import type { ObservationRow } from "./types";

/**
 * Price intelligence, computed only from prices SmartBuy has recorded.
 * Nothing here predicts a future price.
 */

export type SeriesPoint = {
  /** Calendar day in India (YYYY-MM-DD). */
  day: string;
  /** Timestamp of the observation that set the day's lowest price. */
  at: string;
  /** Lowest recorded price that day. */
  price: number;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function istDay(iso: string | Date): string {
  const ms = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Collapse raw observations into one point per day: the lowest price recorded
 * that day across the listings that count for this product.
 */
export function buildDailySeries(
  observations: ObservationRow[],
  includeListing?: (listingId: string) => boolean,
): SeriesPoint[] {
  const byDay = new Map<string, SeriesPoint>();
  for (const o of observations) {
    if (includeListing && !includeListing(o.listing_id)) continue;
    const price = Number(o.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const day = istDay(o.observed_at);
    const existing = byDay.get(day);
    if (!existing || price < existing.price) {
      byDay.set(day, { day, at: o.observed_at, price });
    }
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

export type PriceChange = { days: number; from: number; fromDay: string; pct: number };

export type PriceStats = {
  current: number;
  currentAt: string;
  high: number;
  highDay: string;
  low: number;
  lowDay: string;
  average: number;
  average30: number | null;
  /** Number of distinct days with a recorded price. */
  days: number;
  /** Days between the first and the latest recorded price. */
  spanDays: number;
  firstDay: string;
  lastDay: string;
  changes: PriceChange[];
  vsAverage30Pct: number | null;
  nearLow: boolean;
};

function dayToMs(day: string): number {
  return new Date(`${day}T00:00:00Z`).getTime();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeStats(series: SeriesPoint[]): PriceStats | null {
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const first = series[0];

  let high = first;
  let low = first;
  let sum = 0;
  for (const p of series) {
    if (p.price > high.price) high = p;
    // On ties keep the most recent day as "the low".
    if (p.price <= low.price) low = p;
    sum += p.price;
  }

  const lastMs = dayToMs(last.day);
  const window30 = series.filter((p) => lastMs - dayToMs(p.day) < 30 * DAY_MS);
  const average30 =
    window30.length >= 2 ? round2(window30.reduce((s, p) => s + p.price, 0) / window30.length) : null;

  const changes: PriceChange[] = [];
  for (const days of [7, 30, 90]) {
    const cutoff = lastMs - days * DAY_MS;
    let ref: SeriesPoint | undefined;
    for (const p of series) {
      if (dayToMs(p.day) <= cutoff) ref = p;
      else break;
    }
    if (ref) {
      changes.push({
        days,
        from: ref.price,
        fromDay: ref.day,
        pct: round2(((last.price - ref.price) / ref.price) * 100),
      });
    }
  }

  return {
    current: last.price,
    currentAt: last.at,
    high: high.price,
    highDay: high.day,
    low: low.price,
    lowDay: low.day,
    average: round2(sum / series.length),
    average30,
    days: series.length,
    spanDays: Math.round((lastMs - dayToMs(first.day)) / DAY_MS),
    firstDay: first.day,
    lastDay: last.day,
    changes,
    vsAverage30Pct: average30 ? round2(((last.price - average30) / average30) * 100) : null,
    nearLow: last.price <= low.price * 1.02,
  };
}

export type GuidanceLevel = "insufficient" | "good" | "fair" | "high";

export type Guidance = {
  level: GuidanceLevel;
  headline: string;
  detail: string;
};

export const MIN_DAYS_FOR_GUIDANCE = 5;
export const MIN_SPAN_FOR_GUIDANCE = 7;

export function buildGuidance(stats: PriceStats | null): Guidance {
  if (!stats) {
    return {
      level: "insufficient",
      headline: "No price history yet",
      detail: "SmartBuy has not recorded a price for this product yet.",
    };
  }

  if (stats.days < MIN_DAYS_FOR_GUIDANCE || stats.spanDays < MIN_SPAN_FOR_GUIDANCE || stats.average30 === null) {
    const dayWord = stats.days === 1 ? "day" : "days";
    return {
      level: "insufficient",
      headline: "Not enough history yet",
      detail: `Prices recorded on ${stats.days} ${dayWord} since ${formatDate(stats.firstDay)}. Guidance appears once there is at least a week of history.`,
    };
  }

  const pct = stats.vsAverage30Pct ?? 0;
  const avgText = `the 30-day recorded average of ${formatINR(stats.average30)}`;

  if (pct <= -5) {
    return {
      level: "good",
      headline: "Good price based on recorded history",
      detail: `${formatINR(stats.current)} is ${Math.abs(pct).toFixed(1)}% below ${avgText}.`,
    };
  }

  if (stats.nearLow && stats.spanDays >= 14 && stats.high > stats.low) {
    return {
      level: "good",
      headline: "Good price based on recorded history",
      detail: `${formatINR(stats.current)} is at or within 2% of the lowest recorded price (${formatINR(stats.low)} on ${formatDate(stats.lowDay)}).`,
    };
  }

  if (pct >= 5) {
    return {
      level: "high",
      headline: "Consider monitoring",
      detail: `${formatINR(stats.current)} is ${pct.toFixed(1)}% above ${avgText}. The lowest recorded price was ${formatINR(stats.low)} on ${formatDate(stats.lowDay)}.`,
    };
  }

  return {
    level: "fair",
    headline: "Consider monitoring",
    detail: `${formatINR(stats.current)} is close to ${avgText}. The lowest recorded price was ${formatINR(stats.low)} on ${formatDate(stats.lowDay)}.`,
  };
}
