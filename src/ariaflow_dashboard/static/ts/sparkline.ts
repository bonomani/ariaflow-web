// Sparkline / timeline SVG rendering — no Alpine dependency.

import { formatBytes, formatRate } from './formatters';

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
  const padTop = 8;
  const padBottom = 18; // room for x-axis labels
  const padRight = 4;
  const chartH = h - padTop - padBottom;
  const capBps = capMbps > 0 ? (capMbps * 1_000_000) / 8 : 0;
  // Y-scale max: include cap so the cap line sits inside the chart.
  const yMax = Math.max(peakDl + peakUl, capBps, 1);
  const samples = dl.length;
  const step = (w - padRight) / (samples - 1);
  const yOf = (v: number): number => padTop + chartH - (v / yMax) * chartH;
  // Stacked: ul rides on top of dl.
  const dlPath = dl.map((v, i) => `${(i * step).toFixed(1)},${yOf(v).toFixed(1)}`);
  const ulStacked = ul.length ? ul.map((v, i) => yOf((dl[i] ?? 0) + v)) : [];
  // Build closed polygons for fill (start and end at baseline).
  const baseline = yOf(0);
  const dlPoly = `0,${baseline} ${dlPath.join(' ')} ${((samples - 1) * step).toFixed(1)},${baseline}`;
  // Closed polygon: lower edge (dl line) forward, upper edge (dl+ul) backward.
  const ulPoly = ulStacked.length
    ? `${dl.map((v, i) => `${(i * step).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')} ${ulStacked.map((y, i) => `${(i * step).toFixed(1)},${y.toFixed(1)}`).reverse().join(' ')}`
    : '';
  const capY = capBps > 0 ? yOf(capBps) : null;
  // X-axis time labels: 5 ticks, oldest → now. Total window ≈
  // (samples - 1) * refreshInterval.
  const totalSecs = ((samples - 1) * refreshIntervalMs) / 1000;
  // Fewer ticks for short windows so integer-second labels stay
  // evenly spaced (4 subdivisions of 6s = uneven 1.5s gaps).
  const tickFracs = totalSecs < 12 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  const ticks = tickFracs.map((frac) => {
    const x = frac * (w - padRight);
    const secsAgo = (1 - frac) * totalSecs;
    const label = frac === 1
      ? 'now'
      : `-${totalSecs < 10 ? secsAgo.toFixed(1) : Math.round(secsAgo)}s`;
    return `<text x="${x.toFixed(1)}" y="${(h - 4).toFixed(1)}" fill="var(--ws-muted)" font-size="10" text-anchor="${frac === 0 ? 'start' : frac === 1 ? 'end' : 'middle'}">${label}</text>`;
  }).join('');
  const capLabel = capBps > 0 && capY != null
    ? `<text x="4" y="${(capY - 2).toFixed(1)}" fill="var(--ws-muted)" font-size="10">cap ${capMbps} Mbps</text>`
    : '';
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;width:100%;height:${h}px;">
    <polygon points="${dlPoly}" fill="var(--ws-accent)" fill-opacity="0.35" stroke="var(--ws-accent)" stroke-width="1.2"/>
    ${ulPoly ? `<polygon points="${ulPoly}" fill="var(--ws-accent-2)" fill-opacity="0.35" stroke="var(--ws-accent-2)" stroke-width="1"/>` : ''}
    ${capY != null ? `<line x1="0" x2="${w - padRight}" y1="${capY.toFixed(1)}" y2="${capY.toFixed(1)}" stroke="var(--ws-muted)" stroke-width="1" stroke-dasharray="4,3"/>` : ''}
    ${capLabel}
    ${ticks}
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
