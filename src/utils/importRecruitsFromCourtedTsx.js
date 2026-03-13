// src/utils/importRecruitsFromCourtedTsv.js
import Papa from "papaparse";
import {
  doc,
  getDoc,
  collection,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { docIdFromEmail } from "./docIdFromEmail";
import { parseDateAny, toNumber, parsePercent } from "./importHelpers";
import { parseNoteToJournalDoc } from "./parseNoteToEntry";

// -------------------- helpers (TOP LEVEL) --------------------
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

// Preflight: detects duplicates in file + existing recruits in Firestore.
// Default policy:
// - Block if duplicate emails in the file
// - Skip if recruit already exists in Firestore
// - Warn if duplicate names in the file (does not block)
async function preflightCourtedRows(rows) {
  // 1) Duplicate emails in the file (BLOCK)
  const emailToRowIndexes = new Map();
  const duplicateEmailsInFile = [];

  for (let i = 0; i < rows.length; i++) {
    const email = normEmail(rows[i]["Email"]);
    if (!email) continue;

    const arr = emailToRowIndexes.get(email) || [];
    arr.push(i + 1); // 1-based for humans
    emailToRowIndexes.set(email, arr);
  }

  for (const [email, idxs] of emailToRowIndexes.entries()) {
    if (idxs.length > 1) duplicateEmailsInFile.push({ email, rows: idxs });
  }

  // 2) Duplicate names in the file (WARNING)
  const nameKeyToRows = new Map();
  const duplicateNamesInFile = [];

  for (let i = 0; i < rows.length; i++) {
    const first = normName(rows[i]["First Name"]);
    const last = normName(rows[i]["Last Name"]);
    if (!first && !last) continue;

    const key = `${first} ${last}`.trim();
    const arr = nameKeyToRows.get(key) || [];
    arr.push(i + 1);
    nameKeyToRows.set(key, arr);
  }

  for (const [name, idxs] of nameKeyToRows.entries()) {
    if (idxs.length > 1) duplicateNamesInFile.push({ name, rows: idxs });
  }

  if (duplicateEmailsInFile.length) {
    return {
      ok: false,
      reason: "duplicate_emails_in_file",
      duplicateEmailsInFile,
      duplicateNamesInFile,
      existingInFirestore: [],
      importableRows: [],
    };
  }

  // 3) Existing recruits in Firestore (SKIP by default)
  const existingInFirestore = [];
  const importableRows = [];

  // Concurrency limiter (safe for larger files)
  const concurrency = 20;
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const i = cursor++;
      const r = rows[i];

      const email = normEmail(r["Email"]);
      if (!email) continue;

      const recruitId = docIdFromEmail(email);
      const recruitRef = doc(db, "recruits", recruitId);
      const snap = await getDoc(recruitRef);

      if (snap.exists()) {
        existingInFirestore.push({ row: i + 1, email, recruitId });
      } else {
        importableRows.push({ rowIndex: i, email, recruitId });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  return {
    ok: true,
    duplicateEmailsInFile,
    duplicateNamesInFile,
    existingInFirestore,
    importableRows,
  };
}

// -------------------- main importer --------------------
export async function importCourtedRecruits(file) {
  const rows = await new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: "\t",
      complete: (res) => resolve(res.data),
      error: (err) => reject(err),
    });
  });

  // ✅ Preflight check (NO WRITES YET)
  const report = await preflightCourtedRows(rows);

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

  const importNow = new Date();
  const importedAtTs = Timestamp.fromDate(importNow);

  // We chunk commits to avoid Firestore batch write limits.
  // Each recruit can produce up to 4 writes (1 recruit doc + up to 3 journal docs).
  const MAX_WRITES_PER_COMMIT = 400;

  let pending = [];
  let totalWrites = 0;

  async function commitPending() {
    if (pending.length === 0) return;
    const batch = writeBatch(db);
    for (const w of pending) batch.set(w.ref, w.data, { merge: true });
    await batch.commit();
    totalWrites += pending.length;
    pending = [];
  }

  // ✅ Import ONLY the rows that do not already exist in Firestore
  for (const item of report.importableRows) {
    const idx = item.rowIndex;
    const r = rows[idx];

    const email = normEmail(r["Email"]);
    if (!email) continue;

    const recruitId = docIdFromEmail(email);
    const recruitRef = doc(db, "recruits", recruitId);

    // Dates
    const lastInteractionDate = parseDateAny(r["Last Interaction Date"]);
    const addedDate = parseDateAny(r["Added Date"]);

    const recruitPayload = {
      firstName: String(r["First Name"] ?? "").trim() || null,
      lastName: String(r["Last Name"] ?? "").trim() || null,
      currentOffice: String(r["Current Office"] ?? "").trim() || null,
      email,
      phone: String(r["Phone"] ?? "").trim() || null,
      assignedAgent: String(r["Assigned To"] ?? "").trim() || null,
      status: String(r["Status"] ?? "").trim() || null,

      lastInteraction: lastInteractionDate
        ? Timestamp.fromDate(lastInteractionDate)
        : null,
      lastInteractionMs: lastInteractionDate
        ? lastInteractionDate.getTime()
        : null,

      yearsInIndustry: toNumber(r["Years in Industry"]),
      ltmSalesVolume: toNumber(r["LTM Sales Volume"]),
      ltmSalesVolumeGrowthPct: parsePercent(r["LTM Sales Volume % Growth"]),
      potentialToMove: String(r["Potential to Move"] ?? "").trim() || null,
      yearsInOffice: toNumber(r["Years in Office"]),

      importedAt: importedAtTs,
      updatedAt: serverTimestamp(),
    };

    pending.push({ ref: recruitRef, data: recruitPayload });

    // Journal notes → deterministic IDs so reruns don’t duplicate
    const journalBaseFallback = lastInteractionDate || addedDate || importNow;

    const notes = [
      { col: "Note 1", id: "csv-note1", value: r["Note 1"], offsetMs: 3000 },
      { col: "Note 2", id: "csv-note2", value: r["Note 2"], offsetMs: 2000 },
      { col: "Note 3", id: "csv-note3", value: r["Note 3"], offsetMs: 1000 },
    ];

    for (const n of notes) {
      const fallback = new Date(journalBaseFallback.getTime() + n.offsetMs);
      const parsed = parseNoteToJournalDoc(n.value, {
        csvColumn: n.col,
        fallbackDate: fallback,
      });
      if (!parsed) continue;

      const journalRef = doc(
        collection(db, "recruits", recruitId, "journal"),
        n.id
      );

      pending.push({
        ref: journalRef,
        data: {
          text: parsed.text,
          createdAt: Timestamp.fromDate(parsed.createdAtDate),
          createdAtMs: parsed.createdAtDate.getTime(),
          source: "csv",
          csvColumn: parsed.csvColumn,
          importedAt: importedAtTs,
          raw: parsed.raw,
          updatedAt: serverTimestamp(),
        },
      });
    }

    if (pending.length >= MAX_WRITES_PER_COMMIT) {
      await commitPending();
    }
  }

  await commitPending();

  // ✅ Return a useful report so your UI can “alert” you
  return {
    rows: rows.length,
    importedCount: report.importableRows.length,
    skippedExistingCount: report.existingInFirestore.length,
    duplicateNamesWarningCount: report.duplicateNamesInFile.length,
    skippedExisting: report.existingInFirestore,
    duplicateNamesInFile: report.duplicateNamesInFile,
    writes: totalWrites,
  };
}
