// src/utils/parseNoteToEntry.js
import { cleanText, parseDateAny } from "./importHelpers";

function extractDateFromNote(text) {
  const t = text || "";
  // looks for MM/DD/YYYY in the note body
  const m = t.match(/\b(\d{1,2}\/\d{1,2}\/20\d{2})\b/);
  if (m) return parseDateAny(m[1]);
  // looks for YYYY-MM-DD
  const ymd = t.match(/\b(20\d{2}-\d{1,2}-\d{1,2})\b/);
  if (ymd) return parseDateAny(ymd[1]);
  return null;
}

export function parseNoteToJournalDoc(noteValue, { csvColumn, fallbackDate }) {
  const raw = cleanText(noteValue);
  if (!raw) return null;

  const extracted = extractDateFromNote(raw);
  const createdAtDate = extracted || fallbackDate;

  return {
    text: raw,                 // keep as-is (readable)
    createdAtDate,
    source: "csv",
    csvColumn,
    raw,
  };
}
