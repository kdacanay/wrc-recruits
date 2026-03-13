import { STATUS_OPTIONS } from "../constants/recruitOptions";

// exact old/alternate labels -> canonical label
const STATUS_ALIASES = {
  "Identified (from Courted)": "Identified",
  "Set status": null, // Courted placeholder

  // old phase-style statuses that should no longer live in Status
  "Engagement phase": "Identified",
  "Engagement Phase": "Identified",
  "Engagement": "Identified",

  "Relationship building": "Identified",
  "Relationship Building": "Identified",
  "Relationship Building Phase": "Identified",

  "Sphere of influence": "Long-term management",
  "Sphere of Influence": "Long-term management",
  "Relationship management": "Long-term management",
  "Relationship Management": "Long-term management",

  // duplicates / close variants
  "Long-term": "Long-term management",
  "Long term": "Long-term management",
  "Long Term": "Long-term management",
  "long-term": "Long-term management",
  "long term": "Long-term management",

  "Long-term mgmt": "Long-term management",
  "Long term mgmt": "Long-term management",
  "Long-term Management": "Long-term management",

  "Short-term": "Short-term management",
  "Short term": "Short-term management",
  "Short Term": "Short-term management",
  "short-term": "Short-term management",
  "short term": "Short-term management",

  "Short-term mgmt": "Short-term management",
  "Short term mgmt": "Short-term management",
  "Short-term Management": "Short-term management",

  "Meeting Scheduled": "Meeting scheduled",
  "Meeting Held": "Meeting held",
  "Interviewing ": "Interviewing",
  "Not Interested": "Not interested",
  "Not Qualified": "Not qualified",
  "Contract Out": "Contract out",
  "Recruited ": "Recruited",

  // optional extras if old data has these
  "Signed": "Recruited",
  "Hired": "Recruited",
  "New hire": "Recruited",
  "New Hire": "Recruited",
  "Lost": "Not interested",
};

// lowercase normalized aliases
const STATUS_ALIASES_LOWER = Object.fromEntries(
  Object.entries(STATUS_ALIASES).map(([key, value]) => [
    key.trim().toLowerCase(),
    value,
  ])
);

function clean(s) {
  return String(s || "").trim();
}

export function normalizeRecruitStatus(raw) {
  const v = clean(raw);
  if (!v) return null;

  const lower = v.toLowerCase();

  // 1) exact alias match first
  if (lower in STATUS_ALIASES_LOWER) {
    return STATUS_ALIASES_LOWER[lower];
  }

  // 2) exact case-insensitive match against official list
  const canonicalHit = STATUS_OPTIONS.find(
    (opt) => opt.toLowerCase() === lower
  );
  if (canonicalHit) return canonicalHit;

  // 3) extra fuzzy cleanup for spacing/dashes
  const normalizedLoose = lower
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\blong term\b/g, "long-term")
    .replace(/\bshort term\b/g, "short-term")
    .trim();

  if (normalizedLoose === "long-term") return "Long-term management";
  if (normalizedLoose === "short-term") return "Short-term management";
  if (normalizedLoose === "long-term management") return "Long-term management";
  if (normalizedLoose === "short-term management") return "Short-term management";
  if (normalizedLoose === "meeting scheduled") return "Meeting scheduled";
  if (normalizedLoose === "meeting held") return "Meeting held";
  if (normalizedLoose === "contract out") return "Contract out";
  if (normalizedLoose === "not interested") return "Not interested";
  if (normalizedLoose === "not qualified") return "Not qualified";
  if (normalizedLoose === "sphere of influence") return "Long-term management";
  if (normalizedLoose === "relationship management") return "Long-term management";
  if (normalizedLoose === "relationship building") return "Identified";
  if (normalizedLoose === "engagement phase") return "Identified";

  // 4) keep unknown values so you can spot weird imports later
  return v;
}