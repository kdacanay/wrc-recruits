// src/pages/AdminImportRecruits.jsx (or a helper module)
import Papa from "papaparse";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { docIdFromEmail } from "../utils/docIdFromEmail";
import { parseNoteToJournalEntry } from "../utils/parseNote";

// small helpers
function toNumber(v) {
  const n = Number(String(v ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}
function toStringOrNull(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}
function normEmail(v) {
  return String(v ?? "").trim().toLowerCase();
}

function normName(v) {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function preflightRows(parsed) {
  // A) duplicate emails in file (BLOCK)
  const emailToRows = new Map();
  const duplicateEmailsInFile = [];

  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];
    const email = normEmail(raw.Email || raw.email || raw["Agent Email"]);
    if (!email) continue;

    const arr = emailToRows.get(email) || [];
    arr.push(i + 1);
    emailToRows.set(email, arr);
  }

  for (const [email, idxs] of emailToRows.entries()) {
    if (idxs.length > 1) duplicateEmailsInFile.push({ email, rows: idxs });
  }

  if (duplicateEmailsInFile.length) {
    return { ok: false, duplicateEmailsInFile, existingInFirestore: [], importableIdxs: [] };
  }

  // B) (optional warning) duplicate names in file
  const nameToRows = new Map();
  const duplicateNamesInFile = [];

  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];
    const first = normName(raw["First Name"] || raw.firstName);
    const last = normName(raw["Last Name"] || raw.lastName);
    const key = `${first} ${last}`.trim();
    if (!key) continue;

    const arr = nameToRows.get(key) || [];
    arr.push(i + 1);
    nameToRows.set(key, arr);
  }

  for (const [name, idxs] of nameToRows.entries()) {
    if (idxs.length > 1) duplicateNamesInFile.push({ name, rows: idxs });
  }

  // C) existing in Firestore (SKIP)
  const existingInFirestore = [];
  const importableIdxs = [];

  const concurrency = 20;
  let cursor = 0;

  async function worker() {
    while (cursor < parsed.length) {
      const i = cursor++;
      const raw = parsed[i];
      const email = normEmail(raw.Email || raw.email || raw["Agent Email"]);
      if (!email) continue;

      const recruitId = docIdFromEmail(email);
      const ref = doc(db, "recruits", recruitId);
      const snap = await getDoc(ref);

      if (snap.exists()) existingInFirestore.push({ row: i + 1, email, recruitId });
      else importableIdxs.push(i);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  return { ok: true, duplicateNamesInFile, existingInFirestore, importableIdxs };
}


export async function importRecruitsFromCsvFile(file) {
  const parsed = await new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: (err) => reject(err),
    });
  });
  const report = await preflightRows(parsed);

  if (!report.ok) {
    const preview = report.duplicateEmailsInFile
      .slice(0, 20)
      .map((d) => `${d.email} rows ${d.rows.join(", ")}`)
      .join("\n");

    throw new Error(
      `Import blocked: duplicate Email(s) found in file.\n` +
        preview +
        (report.duplicateEmailsInFile.length > 20 ? `\n...and more` : "")
    );
  }

  const batch = writeBatch(db);
  const importNow = new Date();
  const importedAtTs = Timestamp.fromDate(importNow);

  // NOTE: Firestore batch limit is 500 writes.
  // If your CSV is big, we’ll chunk it (simple chunking below).
  const writes = [];

  report.importableIdxs.forEach((idx) => {
    const row = parsed[idx];

    const email = toStringOrNull(row.Email || row.email || row["Agent Email"]);
    if (!email) return;

    const recruitId = docIdFromEmail(email);
    const recruitRef = doc(db, "recruits", recruitId);

    // --- profile fields mapping ---
    const ltmSales = toNumber(row["LTM Sales"]);
    const mostTransactedCity = toStringOrNull(row["Most Transacted City"]);
    const officeCity = toStringOrNull(row["Office City"]);
    const yearsInOffice = toNumber(row["Years in Office"]);

    // You can keep mapping your existing recruit fields here too
    const recruitPayload = {
      email,
      // examples (keep/adjust to your schema)
      firstName: toStringOrNull(row["First Name"] || row.firstName),
      lastName: toStringOrNull(row["Last Name"] || row.lastName),
      phone: toStringOrNull(row["Phone"] || row.phone),

      // new profile fields
      ltmSales: ltmSales ?? null,
      mostTransactedCity: mostTransactedCity ?? null,
      officeCity: officeCity ?? null,
      yearsInOffice: yearsInOffice ?? null,

      // bookkeeping
      importedAt: importedAtTs,
      updatedAt: serverTimestamp(),
    };

    // Write recruit doc (merge so reruns update cleanly)
    writes.push({ type: "setRecruit", ref: recruitRef, data: recruitPayload });

    // --- journal notes ---
    const notes = [
      { col: "Note 1", value: row["Note 1"] },
      { col: "Note 2", value: row["Note 2"] },
      { col: "Note 3", value: row["Note 3"] },
    ];

    notes.forEach((n, noteIndex) => {
      const fallback = new Date(importNow.getTime() - (3 - noteIndex) * 1000); // keeps 1/2/3 ordered
      const parsedEntry = parseNoteToJournalEntry(n.value, fallback, { csvColumn: n.col });
      if (!parsedEntry) return;

      const journalCol = collection(db, "recruits", recruitId, "journal");

      // Deterministic journal ID so rerunning import doesn’t duplicate:
      // (You can tweak to include a hash if needed.)
      const entryId = `csv-${n.col.replace(/\s+/g, "").toLowerCase()}`;

      const journalRef = doc(journalCol, entryId);

      writes.push({
        type: "setJournal",
        ref: journalRef,
        data: {
          text: parsedEntry.text,
          createdAt: Timestamp.fromDate(parsedEntry.createdAtDate),
          createdAtMs: parsedEntry.createdAtDate.getTime(),
          source: "csv",
          csvColumn: n.col,
          importedAt: importedAtTs,
          raw: parsedEntry.meta.raw,
          updatedAt: serverTimestamp(),
        },
      });
    });
  });

  // --- chunk writes into batches of 450-ish to be safe ---
  const CHUNK = 450;
  for (let i = 0; i < writes.length; i += CHUNK) {
    const chunk = writes.slice(i, i + CHUNK);
    const b = writeBatch(db);

    for (const w of chunk) {
      b.set(w.ref, w.data, { merge: true });
    }

    await b.commit();
  }

    return {
    rows: parsed.length,
    writes: writes.length,
    importedCount: report.importableIdxs.length,
    skippedExistingCount: report.existingInFirestore.length,
    duplicateNamesWarningCount: report.duplicateNamesInFile.length,
    skippedExisting: report.existingInFirestore,
    duplicateNamesInFile: report.duplicateNamesInFile,
  };

}
