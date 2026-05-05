// Sparkline / timeline SVG rendering — no Alpine dependency.

import { formatRate } from './formatters';

function sparklinePoints(data: number[], max: number, w: number, h: number): string {
  const step = w / (data.length - 1);
  return data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`)
    .join(' ');
}

export function renderItemSparkline(data: number[] | null | undefined): string {
  if (!data || data.length < 2) return '';
  const max = Math.max(...data, 1);
  const w = 120;
  const h = 28;
  const points = sparklinePoints(data, max, w, h);
  return `<svg width="${w}" height="${h}" style="display:block;margin-top:6px;" viewBox="0 0 ${w} ${h}">
    <polyline points="${points}" fill="none" stroke="var(--ws-accent)" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

/**
 * A7 hero timeline: stacked-area chart for downlink + uplink with a
 * cap reference line and time-axis ticks. Replaces the small global
 * sparkline in the redesigned hero.
 *
 * Data:
 *   - `dl`, `ul` — bytes/sec samples, oldest → newest, length up to
 *     GLOBAL_SPEED_MAX (40)
 *   - `capMbps` — current global cap in Mbps; renders as a horizontal
 *     reference line at the corresponding bytes/sec value. 0 / null
 *     hides the line.
 *   - `refreshIntervalMs` — used to label the X axis ("-N s") so the
 *     time window adapts to the operator's chosen refresh rate.
 *
 * Output: a self-contained SVG with viewBox; CSS sets the width.
 * Time labels and current-value annotations are <text> elements
 * inside the SVG so the whole thing is one node.
 */
function smoothPath(points: Array<[number, number]>): string {
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) return `M${first[0]},${first[1]}`;
  let d = `M${first[0].toFixed(1)},${first[1].toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const cur = points[i]!;
    const next = points[i + 1]!;
    const mx = (cur[0] + next[0]) / 2;
    const my = (cur[1] + next[1]) / 2;
    d += ` Q${cur[0].toFixed(1)},${cur[1].toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = points[points.length - 1]!;
  d += ` L${last[0].toFixed(1)},${last[1].toFixed(1)}`;
  return d;
}

export function renderGlobalTimeline(
  dl: number[],
  ul: number[],
  capMbps: number = 0,
  refreshIntervalMs: number = 10000,
): string {
  if (dl.length < 2) return '';
  const peakDl = Math.max(...dl);
  const peakUl = ul.length ? Math.max(...ul) : 0;
  if (peakDl <= 0 && peakUl <= 0) return '';
  const w = 800;
  const h = 100;
  const padTop = 10;
  const padBottom = 18;
  const padLeft = 0;
  const padRight = 8;
  const chartH = h - padTop - padBottom;
  const chartW = w - padLeft - padRight;
  const capBps = capMbps > 0 ? (capMbps * 1_000_000) / 8 : 0;
  // Y-scale: peak of either series, with headroom and cap visible.
  const yMaxRaw = Math.max(peakDl, peakUl, capBps);
  const yMax = yMaxRaw * 1.1 || 1;
  const samples = dl.length;
  const step = chartW / (samples - 1);
  const xOf = (i: number): number => padLeft + i * step;
  const yOf = (v: number): number => padTop + chartH - (v / yMax) * chartH;

  const dlPts: Array<[number, number]> = dl.map((v, i) => [xOf(i), yOf(v)]);
  const ulPts: Array<[number, number]> = ul.length ? ul.map((v, i) => [xOf(i), yOf(v)]) : [];
  const dlLine = smoothPath(dlPts);
  const baseline = yOf(0);
  const dlArea = `${dlLine} L${xOf(samples - 1).toFixed(1)},${baseline.toFixed(1)} L${xOf(0).toFixed(1)},${baseline.toFixed(1)} Z`;
  const ulLine = ulPts.length && peakUl > 0 ? smoothPath(ulPts) : '';

  const capY = capBps > 0 ? yOf(capBps) : null;
  const capLabel =
    capBps > 0 && capY != null
      ? `<text x="${(w - padRight).toFixed(1)}" y="${(capY - 3).toFixed(1)}" fill="var(--ws-muted)" font-size="10" text-anchor="end">cap ${capMbps} Mbps</text>`
      : '';

  // Endpoint dot at the latest dl sample for the "now" anchor.
  const lastX = xOf(samples - 1);
  const lastY = yOf(dl[samples - 1] ?? 0);

  // Time ticks: just start and end. Mid is implicit.
  const totalSecs = ((samples - 1) * refreshIntervalMs) / 1000;
  const startLabel = `-${totalSecs < 10 ? totalSecs.toFixed(1) : Math.round(totalSecs)}s`;

  // Subtle baseline rule.
  const baseRule = `<line x1="${padLeft}" x2="${(w - padRight).toFixed(1)}" y1="${baseline.toFixed(1)}" y2="${baseline.toFixed(1)}" stroke="var(--ws-muted)" stroke-opacity="0.25" stroke-width="1"/>`;

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;width:100%;height:${h}px;overflow:visible;">
    <defs>
      <linearGradient id="aft-dl-grad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="var(--ws-accent)" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="var(--ws-accent)" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${baseRule}
    ${capY != null ? `<line x1="${padLeft}" x2="${(w - padRight).toFixed(1)}" y1="${capY.toFixed(1)}" y2="${capY.toFixed(1)}" stroke="var(--ws-muted)" stroke-width="1" stroke-dasharray="4,3"/>` : ''}
    ${capLabel}
    <path d="${dlArea}" fill="url(#aft-dl-grad)" stroke="none"/>
    <path d="${dlLine}" fill="none" stroke="var(--ws-accent)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>
    ${ulLine ? `<path d="${ulLine}" fill="none" stroke="var(--ws-accent-2)" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="3,2"/>` : ''}
    <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3" fill="var(--ws-accent)"/>
    <text x="${padLeft}" y="${(h - 4).toFixed(1)}" fill="var(--ws-muted)" font-size="10" text-anchor="start">${startLabel}</text>
    <text x="${(w - padRight).toFixed(1)}" y="${(h - 4).toFixed(1)}" fill="var(--ws-muted)" font-size="10" text-anchor="end">now</text>
  </svg>`;
}

export function renderGlobalSparkline(dl: number[], ul: number[]): string {
  if (dl.length < 2) return '';
  const peakDlValue = Math.max(...dl);
  const peakUlValue = Math.max(...ul);
  // No traffic in the window — render nothing rather than a flat line
  // and a "peak ↓ 0 B/s" caption that adds clutter while the engine
  // is idle/stopped.
  if (peakDlValue <= 0 && peakUlValue <= 0) return '';
  const max = Math.max(...dl, ...ul, 1);
  const w = 200;
  const h = 40;
  const dlPoints = sparklinePoints(dl, max, w, h);
  const ulPoints = ul.length >= 2 ? sparklinePoints(ul, max, w, h) : '';
  const peakDl = formatRate(peakDlValue);
  const peakUl = peakUlValue > 0 ? ` ↑ ${formatRate(peakUlValue)}` : '';
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
    <polyline points="${dlPoints}" fill="none" stroke="var(--ws-accent)" stroke-width="1.5" stroke-linejoin="round"/>
    ${ulPoints ? `<polyline points="${ulPoints}" fill="none" stroke="var(--ws-accent-2)" stroke-width="1" stroke-linejoin="round" stroke-dasharray="3,2"/>` : ''}
  </svg><span style="font-size:0.78rem;color:var(--ws-muted);">peak ↓ ${peakDl}${peakUl}</span>`;
}
