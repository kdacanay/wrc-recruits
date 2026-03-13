// src/utils/importHelpers.js
export function parseDateAny(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;

  // ISO (e.g., 2025-12-11T18:07:26.020168Z)
  const iso = Date.parse(s);
  if (!Number.isNaN(iso) && /T.*Z$/.test(s)) return new Date(iso);

  // MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));

  // YYYY-MM-DD
  const ymd = s.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));

  return null;
}

export function toNumber(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parsePercent(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // "-15%" -> -15
  const cleaned = s.endsWith("%") ? s.slice(0, -1) : s;
  const n = Number(cleaned.replace(/[,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function cleanText(v) {
  return String(v ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}
