// src/utils/recruitValue.js

// 1) Map your pipeline "levels" to a base probability
// Adjust labels to match EXACTLY what you store in Firestore.
export const LEVEL_PROB = {
  "Engagement phase": 0.20,
  "Relationship phase": 0.45,
  "Sphere of influence": 0.75,
  "DNC": 0.0,
};

// 2) Map urgency labels to probability
export const URGENCY_PROB = {
  "Very low likelihood": 0.10,
  "Low likelihood": 0.25,
  "Not sure": 0.40,
  "Likely": 0.65,
  "Very likely": 0.85,
};

// 3) Map relationship % labels to probability
// Your options: "0% or new lead", "18%", "34%", "56%", "78%"
export const RELATIONSHIP_PROB = {
  "0% or new lead": 0.05,
  "18%": 0.18,
  "34%": 0.34,
  "56%": 0.56,
  "78%": 0.78,
};

export function clamp01(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function calcProbability(recruit, weights = { level: 0.5, urgency: 0.3, relationship: 0.2 }) {
  const levelLabel = recruit?.pipelineLevel || recruit?.status || ""; // fallback if needed
  const urgencyLabel = recruit?.urgency || "";
  const relationshipLabel = recruit?.relationship || "";

  const levelP = LEVEL_PROB[levelLabel] ?? 0;
  const urgP = URGENCY_PROB[urgencyLabel] ?? 0;
  const relP = RELATIONSHIP_PROB[relationshipLabel] ?? 0;

  const prob =
    (levelP * weights.level) +
    (urgP * weights.urgency) +
    (relP * weights.relationship);

  return clamp01(prob);
}

export function calcExpectedValue(recruit, weights) {
  const companyDollar = Number(recruit?.projectedCompanyDollar || 0);
  const prob = calcProbability(recruit, weights);
  return Math.round(companyDollar * prob);
}

export function formatPercent(p) {
  const pct = Math.round((p || 0) * 1000) / 10; // 1 decimal
  return `${pct}%`;
}

export function formatMoney(n) {
  const val = Number(n || 0);
  return val.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}