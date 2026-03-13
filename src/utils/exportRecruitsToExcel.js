// src/utils/exportRecruitsToExcel.js
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { collection, getDocs, query, orderBy, where } from "firebase/firestore";
import { db } from "../firebase";

function levelLabel(level) {
  const v = String(level ?? "").trim();
  if (v === "DNC") return "DNC";
  if (v === "0") return "Level 0";
  if (v === "1") return "Level 1";
  if (v === "2") return "Level 2";
  if (v === "3") return "Level 3";
  return "";
}

function recruitDisplayName(r) {
  return (
    r.fullName ||
    `${r.firstName || ""} ${r.lastName || ""}`.trim() ||
    r.email ||
    ""
  );
}

function tsToLocalString(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
    return d ? d.toLocaleString() : "";
  } catch {
    return "";
  }
}

function createdAtMillis(entry) {
  const ts = entry?.createdAt;
  return ts?.toMillis?.() ?? (ts ? new Date(ts).getTime() : 0);
}

async function fetchJournalDocs({ recruitId, isAdmin }) {
  const journalRef = collection(db, "recruits", recruitId, "journal");

  // Admin: everything
  if (isAdmin) {
    const snap = await getDocs(query(journalRef, orderBy("createdAt", "asc")));
    return snap.docs;
  }

  // Agent: only allowed notes (visibility == null OR "shared")
  const sharedSnap = await getDocs(
    query(journalRef, where("visibility", "==", "shared"), orderBy("createdAt", "asc"))
  );

  const nullSnap = await getDocs(
    query(journalRef, where("visibility", "==", null), orderBy("createdAt", "asc"))
  );

  // Merge + de-dupe
  const seen = new Set();
  const merged = [];
  for (const d of [...sharedSnap.docs, ...nullSnap.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    merged.push(d);
  }

  // Sort after merge to preserve chronological order
  merged.sort((a, b) => {
    const am = createdAtMillis(a.data());
    const bm = createdAtMillis(b.data());
    return am - bm;
  });

  return merged;
}

function formatJournalCombined(docs) {
  if (!docs?.length) return "";

  return docs
    .map((docSnap) => {
      const e = docSnap.data() || {};
      const when = tsToLocalString(e.createdAt);
      const who = e.authorName || e.authorEmail || e.authorUid || "Unknown";
      const vis = e.visibility ? ` (${e.visibility})` : "";
      const text = (e.text || "").trim();

      // Each entry becomes: "1/30/2026, 9:15 AM — Ken (shared): Followed up..."
      return `${when} — ${who}${vis}: ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * ONE ROW PER RECRUIT
 * JournalNotes column = all journal entries combined into one cell (newline-separated)
 *
 * @param {Array} recruits - array of recruit objects (each must include .id)
 * @param {Object} opts
 * @param {boolean} opts.isAdmin - admins get all journal; agents get only shared/null
 */
export async function exportRecruitsToExcel(recruits = [], opts = {}) {
  const list = Array.isArray(recruits) ? recruits : [];
  const isAdmin = !!opts.isAdmin;

  if (!list.length) {
    alert("No recruits to export.");
    return;
  }

  const rows = [];

  for (const r of list) {
    const recruitId = r?.id;
    if (!recruitId) continue;

    let journalDocs = [];
    try {
      journalDocs = await fetchJournalDocs({ recruitId, isAdmin });
    } catch (err) {
      console.error("Journal export read failed for recruit:", recruitId, err);
      journalDocs = [];
    }

    const journalCombined = formatJournalCombined(journalDocs);

    rows.push({
      RecruitID: recruitId,
      Name: recruitDisplayName(r),
      Email: r.email || "",
      Phone: r.phone || "",
      Status: r.status || "",
      Level: levelLabel(r.level || ""),
LevelRaw: r.level || "",

      Relationship: r.relationshipRank || "",
      Urgency: r.urgencyRank || "",
      Source: r.source || r.importedFrom || "",
      CurrentOffice: r.currentOffice || "",
      Potential: r.potential || "",
      YearsInIndustry: r.yearsInIndustry ?? "",
      YearsInOffice: r.yearsInOffice ?? "",
      LTMSalesVolume: r.ltmSalesVolume ?? "",
      LTMSalesGrowthPct: r.ltmSalesVolumeGrowthPct ?? "",
      AssignedAgent: r.assignedAgentName || "",
      AssignedAgentEmail: r.assignedAgentEmail || "",
      LatestActivity: r.lastActivityText || "",
      Updated: tsToLocalString(r.updatedAt),
      JournalNotes: journalCombined,
    });
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Recruits");

  // Make columns a bit more readable (optional)
  worksheet["!cols"] = Object.keys(rows[0] || {}).map((k) => ({
    wch: Math.min(60, Math.max(12, k.length + 2)),
  }));

  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  saveAs(
    new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `WRC_Recruits_Export_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}
