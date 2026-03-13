// src/utils/parseNote.js
const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function cleanText(raw) {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

// Attempts common patterns:
//  - 12/29/2025
//  - 12-29-2025
//  - 2025-12-29
//  - Dec 29, 2025 (or December 29 2025)
function extractDateFromText(text) {
  const t = text.trim();

  // YYYY-MM-DD
  let m = t.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // MM/DD/YYYY or MM-DD-YYYY
  m = t.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));

  // Month name
  m = t.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,)?\s+(20\d{2})\b/);
  if (m) {
    const monthKey = m[1].toLowerCase();
    const month = MONTHS[monthKey];
    if (month !== undefined) return new Date(Number(m[3]), month, Number(m[2]));
  }

  return null;
}

export function parseNoteToJournalEntry(rawNote, fallbackDate, { csvColumn }) {
  const cleaned = cleanText(rawNote);
  if (!cleaned) return null;

  const extracted = extractDateFromText(cleaned);
  const createdAtDate = extracted || fallbackDate;

  // Optional: if a date was found, you can remove it from the visible text
  // so the entry reads cleaner.
  let text = cleaned;
  if (extracted) {
    text = cleaned
      .replace(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/, "")
      .replace(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/, "")
      .replace(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,)?\s+(20\d{2})\b/, "")
      .replace(/[ ]{2,}/g, " ")
      .trim();
  }

  return {
    text,
    createdAtDate,
    meta: {
      source: "csv",
      csvColumn,
      raw: cleaned,
    },
  };
}
