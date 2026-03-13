// src/utils/docIdFromEmail.js
export function docIdFromEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9@._+-]/g, "");
}
