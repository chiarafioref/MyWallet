// Minimal SVG charts (no external library), animated via CSS.
import { formatMoney } from "./utils.js";

// Category palette, shared across charts so a category always gets the same colour.
export const PALETTE = [
  "#4f46e5", "#0ea5e9", "#14b8a6", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#22c55e", "#64748b", "#f97316",
  "#6366f1", "#06b6d4", "#eab308", "#10b981", "#a855f7",
];
export const catColor = (i) => PALETTE[i % PALETTE.length];

export function donutChart(entries, { size = 176, thickness = 20, showLegend = true, centerLabel = "totale mese" } = {}) {
  const data = entries.filter(([, v]) => v > 0);
  const total = data.reduce((s, [, v]) => s + v, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;

  const wrap = document.createElement("div");
  wrap.className = "chart chart--donut";

  if (!total) {
    wrap.innerHTML = `<div class="chart-empty">Nessun dato</div>`;
    return wrap;
  }

  let offset = 0;
  const segments = data
    .map(([label, value], i) => {
      const frac = value / total;
      const seg = `
        <circle cx="${cx}" cy="${cx}" r="${r}" fill="none"
          stroke="${catColor(i)}" stroke-width="${thickness}" stroke-linecap="round"
          stroke-dasharray="${Math.max(0.001, frac * circ - 2)} ${circ}"
          stroke-dashoffset="${-offset * circ}"
          transform="rotate(-90 ${cx} ${cx})"
          style="--i:${i}" />`;
      offset += frac;
      return seg;
    })
    .join("");

  const legend = showLegend
    ? `<ul class="chart-legend">${data
        .map(([label, value], i) => `
          <li style="--i:${i}">
            <span class="dot" style="background:${catColor(i)}"></span>
            <span class="lg-label">${label}</span>
            <span class="lg-value">${formatMoney(value)}</span>
            <span class="lg-pct">${Math.round((value / total) * 100)}%</span>
          </li>`).join("")}</ul>`
    : "";

  wrap.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" class="donut-svg" role="img" aria-label="Spese per categoria">
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${thickness}" />
      ${segments}
      <text x="${cx}" y="${cx - 3}" text-anchor="middle" class="donut-total">${formatMoney(total)}</text>
      <text x="${cx}" y="${cx + 15}" text-anchor="middle" class="donut-sub">${centerLabel}</text>
    </svg>
    ${legend}`;
  return wrap;
}
