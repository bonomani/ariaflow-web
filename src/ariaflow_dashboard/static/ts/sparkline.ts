// Sparkline SVG rendering — no Alpine dependency.

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
    <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
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
    <polyline points="${dlPoints}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
    ${ulPoints ? `<polyline points="${ulPoints}" fill="none" stroke="var(--accent-2)" stroke-width="1" stroke-linejoin="round" stroke-dasharray="3,2"/>` : ''}
  </svg><span style="font-size:0.78rem;color:var(--muted);">peak ↓ ${peakDl}${peakUl}</span>`;
}
