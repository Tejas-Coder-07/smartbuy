"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ChartPoint = { day: string; price: number };

const DEFAULT_WIDTH = 720;
const PAD = { top: 16, right: 20, bottom: 34, left: 60 };
const DAY_MS = 24 * 60 * 60 * 1000;

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortDayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function dayMs(day: string): number {
  return new Date(`${day}T00:00:00Z`).getTime();
}

function axisLabel(value: number): string {
  if (value >= 10_000_000) return `₹${trim(value / 10_000_000)} Cr`;
  if (value >= 100_000) return `₹${trim(value / 100_000)} L`;
  if (value >= 1_000) return `₹${trim(value / 1_000)}k`;
  return `₹${Math.round(value)}`;
}

function trim(n: number): string {
  return n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2).replace(/\.?0+$/, "");
}

/** Round axis bounds so tick labels are clean numbers. */
function niceScale(min: number, max: number, ticks = 4): { lo: number; hi: number; step: number } {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / ticks;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 2.5, 5, 10].find((m) => m * pow >= rough) ?? 10;
  const step = unit * pow;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

/**
 * Lowest recorded price per day. One series, so the title names it and no
 * legend is needed. Hover or focus-drag shows the exact day and price; the
 * same data is available as a table below the chart.
 */
export function PriceChart({ points }: { points: ChartPoint[] }) {
  const titleId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  // Draw at the container's real pixel width so axis text stays readable on phones.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setWidth(Math.max(280, Math.round(frame.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const W = width;
  const H = width < 480 ? 220 : 280;

  const model = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map((p) => dayMs(p.day));
    const prices = points.map((p) => p.price);
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    const spanMs = Math.max(x1 - x0, DAY_MS);
    const { lo, hi, step } = niceScale(Math.min(...prices), Math.max(...prices));
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const sx = (ms: number) => (points.length === 1 ? PAD.left + innerW / 2 : PAD.left + ((ms - x0) / spanMs) * innerW);
    const sy = (price: number) => PAD.top + (1 - (price - lo) / (hi - lo)) * innerH;
    const coords = points.map((p, i) => ({ x: sx(xs[i]), y: sy(p.price) }));
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

    const labelIdx = Array.from(new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]));
    const xLabels = labelIdx
      .map((i) => ({
        x: coords[i].x,
        text: shortDayFmt.format(new Date(xs[i])),
        anchor: (points.length === 1 ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle") as "start" | "middle" | "end",
      }))
      .filter((l, i, arr) => i === 0 || l.x - arr[i - 1].x > 90);

    return { coords, ticks, path, sy, xLabels };
  }, [points, W, H]);

  if (!model) return null;

  const onMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let best = Infinity;
    model.coords.forEach((c, i) => {
      const d = Math.abs(c.x - x);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setActive(nearest);
  };

  const a = active !== null ? { ...model.coords[active], ...points[active] } : null;
  const tipLeft = a ? Math.min(Math.max((a.x / W) * 100, 12), 88) : 0;

  return (
    <figure className="m-0">
      <figcaption id={titleId} className="mb-2 text-sm text-muted">
        Lowest recorded price per day, across stores selling this variant
      </figcaption>
      <div className="relative" ref={frameRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={titleId}
          className="block h-auto w-full touch-pan-y select-none"
          onPointerMove={(e) => onMove(e.clientX)}
          onPointerDown={(e) => onMove(e.clientX)}
          onPointerLeave={() => setActive(null)}
        >
          {model.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={model.sy(t)} y2={model.sy(t)} stroke="#e4e6f0" strokeWidth={1} />
              <text x={PAD.left - 10} y={model.sy(t)} textAnchor="end" dominantBaseline="middle" fontSize={12} fill="#5c6080">
                {axisLabel(t)}
              </text>
            </g>
          ))}

          {model.xLabels.map((l) => (
            <text key={l.x} x={l.x} y={H - 10} textAnchor={l.anchor} fontSize={12} fill="#5c6080">
              {l.text}
            </text>
          ))}

          {points.length > 1 ? (
            <path d={model.path} fill="none" stroke="#3538cd" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ) : null}

          {points.length <= 31
            ? model.coords.map((c, i) => (
                <circle key={points[i].day} cx={c.x} cy={c.y} r={points.length === 1 ? 5 : 3} fill="#3538cd" stroke="#ffffff" strokeWidth={2} />
              ))
            : null}

          {a ? (
            <g pointerEvents="none">
              <line x1={a.x} x2={a.x} y1={PAD.top} y2={H - PAD.bottom} stroke="#b9bdd3" strokeWidth={1} />
              <circle cx={a.x} cy={a.y} r={6} fill="#3538cd" stroke="#ffffff" strokeWidth={2} />
            </g>
          ) : null}
        </svg>

        {a ? (
          <div
            className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-sm"
            style={{ left: `${tipLeft}%` }}
          >
            <div className="text-muted">{dayFmt.format(new Date(dayMs(a.day)))}</div>
            <div className="price text-base font-bold text-ink">{inr.format(a.price)}</div>
          </div>
        ) : null}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-accent">Show these prices as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" className="num" style={{ textAlign: "right" }}>
                  Lowest recorded price
                </th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.day}>
                  <td>{dayFmt.format(new Date(dayMs(p.day)))}</td>
                  <td className="num">{inr.format(p.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
