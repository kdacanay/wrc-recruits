import React, { useEffect, useMemo, useRef, useState } from "react";

import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { RELATIONSHIP_OPTIONS, URGENCY_OPTIONS, STATUS_OPTIONS } from "../constants/recruitOptions";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { exportRecruitsToExcel } from "../utils/exportRecruitsToExcel";
import { exportMonthlyCyaToExcel } from "../utils/exportMonthlyCyaToExcel";
import { normalizeLevel, levelToPhase } from "../utils/phaseLevel";
import {
  normalizeUrgencyLevel,
  urgencyLevelPillLabel,
  urgencyLevelTone,
  urgencyLevelSortValue,
} from "../utils/urgencyLevel";

function tsToText(ts) {
  if (!ts) return "";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}

function tsToDateTime(ts) {
  if (!ts) return "";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "";
  }
}

function tsToMillis(ts) {
  if (!ts) return 0;
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.getTime();
  } catch {
    return 0;
  }
}

function dateOnly(ts) {
  if (!ts) return null;
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()); // midnight local
  } catch {
    return null;
  }
}

function followUpMeta(nextFollowUpAt) {
  const d = dateOnly(nextFollowUpAt);
  if (!d) return { label: "—", tone: "gray", sub: "" };

  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((d.getTime() - t0.getTime()) / 86400000);

  const label = d.toLocaleDateString();
  if (diffDays < 0) return { label, tone: "red", sub: `Overdue by ${Math.abs(diffDays)}d` };
  if (diffDays === 0) return { label, tone: "orange", sub: "Due today" };
  if (diffDays <= 3) return { label, tone: "orange", sub: `Due in ${diffDays}d` };
  return { label, tone: "green", sub: `Due in ${diffDays}d` };
}

function Pill({ children, tone = "gray" }) {
  const base =
    "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border";
  const tones = {
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    gray: "bg-gray-50 border-gray-200 text-gray-700",
    orange: "bg-orange-50 border-orange-200 text-orange-800",
    red: "bg-red-50 border-red-200 text-red-800",
    green: "bg-green-50 border-green-200 text-green-800",
  };
  return <span className={`${base} ${tones[tone] || tones.gray}`}>{children}</span>;
}

function toneForUrgency(u) {
  const v = String(u || "").toLowerCase();
  if (v === "very likely" || v === "likely") return "red";
  if (v === "not sure") return "gray";
  if (v === "low likelihood" || v === "very low likelihood") return "green";
  return "gray";
}

function toneForPhase(level) {
  const v = normalizeLevel(level); // "" or "0".."3"
  if (v === "0") return "red";
  if (v === "3") return "green";
  if (v === "2") return "orange";
  if (v === "1") return "blue";
  return "gray";
}

function normalizeText(v) {
  return String(v || "").trim().toLowerCase();
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatPhone(phone) {
  if (!phone) return "—";

  const digits = String(phone).replace(/\D/g, ""); // remove non-digits

  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return phone; // fallback if weird format
}
function formatMoney(v) {
  const n = toNum(v);
  if (n === null) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function getActionItemDueMeta(ts) {
  if (!ts) {
    return {
      label: "No due date",
      tone: "none",
      className: "bg-gray-50 text-gray-500 border-gray-200",
      sortValue: Number.POSITIVE_INFINITY,
    };
  }

  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const due = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const today = new Date();
    const nowDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const diffDays = Math.round((due.getTime() - nowDay.getTime()) / 86400000);
    const label = due.toLocaleDateString();

    if (diffDays < 0) {
      return {
        label: `${label} • Overdue`,
        tone: "overdue",
        className: "bg-red-50 text-red-700 border-red-200",
        sortValue: diffDays,
      };
    }

    if (diffDays === 0) {
      return {
        label: `${label} • Due today`,
        tone: "today",
        className: "bg-orange-50 text-orange-700 border-orange-200",
        sortValue: diffDays,
      };
    }

    if (diffDays <= 2) {
      return {
        label: `${label} • Due soon`,
        tone: "soon",
        className: "bg-yellow-50 text-yellow-700 border-yellow-200",
        sortValue: diffDays,
      };
    }

    return {
      label,
      tone: "upcoming",
      className: "bg-green-50 text-green-700 border-green-200",
      sortValue: diffDays,
    };
  } catch {
    return {
      label: "—",
      tone: "none",
      className: "bg-gray-50 text-gray-500 border-gray-200",
      sortValue: Number.POSITIVE_INFINITY,
    };
  }
}
function formatPct(v) {
  const n = toNum(v);
  if (n === null) return "—";
  return `${n}%`;
}



export default function RecruitGrid({
  recruits = [],
  filteredIds = [],
  mode = "agent", // "agent" | "admin"
  denseDefault = false,
  onOpenRecruit,

  // ✅ NEW (for bulk actions)
  selectedIds = [],
  onSelectedIdsChange,
    // ✅ parent can mass-assign filtered without clicking
  onFilteredIdsChange,
currentUser = null,
  currentProfile = null,
  
}) {
  const isAdmin = mode === "admin";
const isAdminUser =
  currentProfile?.role === "admin" || mode === "admin";
  const user = currentUser;
  const profile = currentProfile;

  // TOP scrollbar sync refs
// TOP scrollbar sync refs
const topScrollRef = useRef(null);
const tableScrollRef = useRef(null);
const tableRef = useRef(null);

// auto width for top scrollbar spacer
const [topScrollWidth, setTopScrollWidth] = useState(1560);

  const [q, setQ] = useState("");
  const [dense, setDense] = useState(denseDefault);
const [statusFilter, setStatusFilter] = useState(""); // "" = all

  // sorting
const [sortKey, setSortKey] = useState("lastTouchedAt");
const [sortDir, setSortDir] = useState("asc");


  // saving state per cell
  const [savingKey, setSavingKey] = useState(null);
const [assignedFilter, setAssignedFilter] = useState(""); 
// "" = all, "__unassigned__" = unassigned, otherwise match assignedAgentUid or assignedAgentEmail

const [importFilter, setImportFilter] = useState(""); 
// "" = all, "imports" = only imported, "manual" = only manual
const [levelFilter, setLevelFilter] = useState(""); // "" = all

const [importDays, setImportDays] = useState(7); 
// used only when importFilter="imports"


// default to current month (YYYY-MM)
const [cyaMonth, setCyaMonth] = useState(() => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
});
// admin controls
const [cyaScope, setCyaScope] = useState("self"); // "self" | "all" | "agent"
const [cyaAgentUid, setCyaAgentUid] = useState("");
function getImportedMillis(r) {
  const ts = r.importedAt || r.createdAt; // fallback
  return tsToMillis(ts);
}
async function handleDeleteSelected() {
  if (!isAdmin) return;
  if (!selectedIds.length) {
    alert("Select at least one recruit to delete.");
    return;
  }

  const ok = window.confirm(
    `Delete ${selectedIds.length} recruit(s)? This will also delete their journal subcollection. This cannot be undone.`
  );
  if (!ok) return;

  try {
    const fn = httpsCallable(functions, "deleteSelectedRecruits");
    const res = await fn({ ids: selectedIds });

    // clear selection
    setSelected([]);

    alert(`Deleted ${res.data?.deleted ?? 0} recruit(s).`);
  } catch (err) {
    console.error("Delete selected recruits failed:", err);
    alert(err?.message || "Delete failed. Check console.");
  }
}

  // ---- selection helpers (admin-only) ----
  function setSelected(next) {
    if (!onSelectedIdsChange) return;
    onSelectedIdsChange(next);
  }

  function toggleOne(id) {
    if (!isAdmin) return;
    if (selectedIds.includes(id)) setSelected(selectedIds.filter((x) => x !== id));
    else setSelected([...selectedIds, id]);
  }

  function toggleAll() {
    if (!isAdmin) return;
    if (!Array.isArray(sorted) || sorted.length === 0) return;
    if (selectedIds.length === sorted.length) setSelected([]);
    else setSelected(sorted.map((r) => r.id));
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortTh({ label, k, className = "" }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        className={`text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50 ${className}`}
        title="Click to sort"
      >
        <div className="inline-flex items-center gap-1">
          {label}
          {active ? (
            <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
          ) : null}
        </div>
      </th>
    );
  }
function toDateSafe(ts) {
  if (!ts) return null;
  try {
    return ts.toDate ? ts.toDate() : new Date(ts);
  } catch {
    return null;
  }
}

function daysUntilSafe(ts) {
  const d = toDateSafe(ts);
  if (!d || Number.isNaN(d.getTime())) return null;

  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  return Math.round((d0.getTime() - t0.getTime()) / 86400000);
}

function phaseLabelForGrid(level) {
  return levelToPhase(level);
}

function urgencyLevelLabelForGrid(levelOfUrgency) {
  return urgencyLevelPillLabel(levelOfUrgency);
}
function isImportedRecord(r) {
  return (
    r.createdVia === "import" ||
    !!r.importedAt ||
    String(r.importedFrom || "").toLowerCase().includes("courted") ||
    String(r.source || "").toLowerCase() === "courted"
  );
}
const filteredIdSet = useMemo(() => new Set(filteredIds || []), [filteredIds]);

const visibleRecruits = useMemo(() => {
  if (!filteredIds || filteredIds.length === 0) return recruits || [];
  return (recruits || []).filter((r) => filteredIdSet.has(r.id));
}, [recruits, filteredIds, filteredIdSet]);

  
const filtered = useMemo(() => {
  const s = q.trim().toLowerCase();
  const now = Date.now();
  const daysMs = Number(importDays || 7) * 86400000;

  return visibleRecruits.filter((r) => {
    // 1) status filter
    if (statusFilter && (r.status || "") !== statusFilter) return false;
// 1b) level filter
// 1b) phase filter
if (levelFilter) {
 const lv = normalizeLevel(r.level);

  if (levelFilter === "__unset__") {
    if (lv !== "") return false;
  } else {
    if (lv !== String(levelFilter)) return false;
  }
}

    // 2) assigned filter
    if (assignedFilter) {
      const assignedUid = r.assignedAgentUid || "";
      const assignedEmail = String(r.assignedAgentEmail || "").toLowerCase();

      if (assignedFilter === "__unassigned__") {
        if (assignedUid || assignedEmail) return false;
      } else {
        // try uid match first, else email match
        const f = String(assignedFilter).toLowerCase();
        if (assignedUid !== assignedFilter && assignedEmail !== f) return false;
      }
    }
// if (levelFilter) {
//   const lv = normalizePhaseLevel(r.level);
//   if (lv !== String(levelFilter)) return false;
// }
    // 3) import filter (manual vs imports)
// 3) import filter (manual vs imports)
if (importFilter === "imports") {
  if (!isImportedRecord(r)) return false;

  // optional: "new imports in last N days"
  const importedMs = getImportedMillis(r); // uses importedAt OR createdAt fallback
  if (daysMs > 0 && importedMs && now - importedMs > daysMs) return false;
}

if (importFilter === "manual") {
  if (isImportedRecord(r)) return false;
}


    // 4) search box logic (your existing search)
    if (!s) return true;

    const name = r.fullName || `${r.firstName || ""} ${r.lastName || ""}`.trim() || "";
    const hay = [
      name,
      r.email,
      r.phone,
      r.status,
      r.source,
      r.office,
      r.currentOffice,
      r.potential,
      r.assignedAgentName,
      r.assignedAgentEmail,
      r.relationshipRank,
      r.urgencyRank,
      r.lastActivityText,
    ]
      .filter((x) => x !== null && x !== undefined && String(x).trim() !== "")
      .join(" ")
      .toLowerCase();

    return hay.includes(s);
  });
}, [recruits, q, statusFilter, levelFilter, assignedFilter, importFilter, importDays]);

// const visibleRecruits = useMemo(() => {
//   const base = Array.isArray(recruits) ? recruits : [];

//   if (filteredIds && filteredIds.length > 0) {
//     const set = new Set(filteredIds);
//     return base.filter((r) => set.has(r.id));
//   }

//   return base;
// }, [recruits, filteredIds]);


  const sorted = useMemo(() => {
    const arr = [...filtered];

    const getVal = (r) => {
      const name =
        r.fullName ||
        `${r.firstName || ""} ${r.lastName || ""}`.trim() ||
        r.email ||
        "";

      switch (sortKey) {
        case "name":
          return normalizeText(name);
        case "status":
          return normalizeText(r.status);
        case "relationshipRank":
          return normalizeText(r.relationshipRank);
        case "urgencyRank":
          return URGENCY_OPTIONS.indexOf(r.urgencyRank || "Not Sure");
        // case "nextFollowUpAt":
        //   return tsToMillis(r.nextFollowUpAt);
        case "updatedAt":
          return tsToMillis(r.updatedAt);
case "actionItemDueAt":
  return getActionItemDueMeta(r.actionItemDueAt).sortValue;
        case "currentOffice":
          return normalizeText(r.currentOffice);
        case "potential":
          return normalizeText(r.potential);
        case "yearsInIndustry":
          return toNum(r.yearsInIndustry) ?? -1;
        case "yearsInOffice":
          return toNum(r.yearsInOffice) ?? -1;
        case "ltmSalesVolume":
          return toNum(r.ltmSalesVolume) ?? -1;
        case "ltmSalesVolumeGrowthPct":
          return toNum(r.ltmSalesVolumeGrowthPct) ?? -999;
          case "levelOfUrgency":
  return urgencyLevelSortValue(r.levelOfUrgency);
case "lastTouchedAt":
  return tsToMillis(r.lastTouchedAt);

case "level": {
  const lv = normalizeLevel(r.level);
  return lv ? Number(lv) : 99;
}

case "levelOfUrgency":
  return urgencyLevelSortValue(r.levelOfUrgency);
        default:
          return normalizeText(r[sortKey]);
      }
    };

    arr.sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);

      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return arr;
  }, [filtered, sortKey, sortDir]);

 
  const rowPad = dense ? "py-2" : "py-3";
  const cellText = dense ? "text-xs" : "text-sm";

  async function updateRecruitField(recruit, patch, activityText) {
    if (!recruit?.id) return;

    const key = `${recruit.id}:${Object.keys(patch)[0]}`;
    setSavingKey(key);

    try {
      await updateDoc(doc(db, "recruits", recruit.id), {
        ...patch,
        lastActivityText: activityText,
        lastActivityAt: serverTimestamp(),
        lastTouchedAt: serverTimestamp(),   // ✅ add this
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Inline update failed:", err);
      alert("Could not save change (check console).");
    } finally {
      setSavingKey(null);
    }
  }

  // Auto-measure top scrollbar width so it ALWAYS reaches the true end
  useEffect(() => {
    const table = tableRef.current;
    const scroller = tableScrollRef.current;
    if (!table || !scroller) return;

    const measure = () => {
      const w = Math.max(table.scrollWidth || 0, scroller.scrollWidth || 0);
      if (w) setTopScrollWidth(w);
    };

    measure();

    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(() => measure());
    ro.observe(table);

    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [sorted.length, dense, mode, isAdmin]);

  // ---- sticky offsets ----
  // If admin: checkbox col (48px) + name col (320px)
  const CHECK_W = 48;
  const NAME_W = 320;
  const CONTACT_W = 280;

  const nameLeft = isAdmin ? CHECK_W : 0;
  const contactLeft = isAdmin ? CHECK_W + NAME_W : NAME_W;
const statusOptionsForFilter = useMemo(() => {
  const fromData = Array.from(
    new Set((visibleRecruits || []).map((r) => r.status).filter(Boolean))
  );

  // Put canonical first, then any unknowns from data
  const unknowns = fromData.filter(
    (s) => !STATUS_OPTIONS.some((o) => o.toLowerCase() === String(s).toLowerCase())
  );

  return [...STATUS_OPTIONS, ...unknowns].filter(Boolean);
}, [visibleRecruits]);

  return (
    <div
      className="bg-white rounded-2xl shadow-lg border border-gray-100 flex flex-col w-full min-h-0"
      style={{ height: "calc(100vh - 220px)" }}
    >
   {/* toolbar */}
<div className="p-4 flex flex-col gap-3">
  {/* row 1: title + main controls (wraps) */}
  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
    <div>
      <div className="text-lg font-bold text-[var(--color-wrcBlack)]">
        {mode === "admin" ? "Recruits" : "My Recruits"}
      </div>
      <div className="text-xs text-gray-500">
        Showing {sorted.length} of {visibleRecruits.length}

      </div>
      
    </div>

    <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end w-full md:w-auto">
      {/* Admin-only controls */}
      {mode === "admin" && (
        <>
          <button
            type="button"
            onClick={handleDeleteSelected}
            disabled={!selectedIds.length}
            className={`px-3 py-2 rounded-md text-sm font-semibold border ${
              selectedIds.length
                ? "bg-red-600 text-white border-red-700 hover:bg-red-700"
                : "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
            }`}
          >
            Delete Selected ({selectedIds.length})
          </button>

          <select
            value={assignedFilter}
            onChange={(e) => setAssignedFilter(e.target.value)}
            className="px-3 py-2 rounded-md border border-gray-200"
            title="Filter by assigned agent"
          >
            <option value="">All assigned agents</option>
            <option value="__unassigned__">Unassigned</option>
            {Array.from(
              new Map(
                recruits
                  .filter((r) => r.assignedAgentUid || r.assignedAgentEmail)
                  .map((r) => [
                    r.assignedAgentUid || String(r.assignedAgentEmail).toLowerCase(),
                    {
                      label: r.assignedAgentName || r.assignedAgentEmail,
                      value: r.assignedAgentUid || String(r.assignedAgentEmail).toLowerCase(),
                    },
                  ])
              ).values()
            ).map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-md border border-gray-200"
            title="Filter by status"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

<select
  value={levelFilter}
  onChange={(e) => setLevelFilter(e.target.value)}
  className="px-3 py-2 rounded-md border border-gray-200"
  title="Filter by phase"
>
  <option value="">All phases</option>
  <option value="1">Engagement Phase</option>
  <option value="2">Relationship Building Phase</option>
  <option value="3">Sphere of Influence</option>
  <option value="0">DNC</option>
  <option value="__unset__">Not Set</option>
</select>

          <select
            value={importFilter}
            onChange={(e) => setImportFilter(e.target.value)}
            className="px-3 py-2 rounded-md border border-gray-200"
            title="Filter imports vs manual"
          >
            <option value="">All records</option>
            <option value="imports">Imported only</option>
            <option value="manual">Manual only</option>
          </select>

          {importFilter === "imports" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600">Last</span>
              <input
                type="number"
                min="1"
                max="365"
                value={importDays}
                onChange={(e) => setImportDays(e.target.value)}
                className="w-[90px] px-3 py-2 rounded-md border border-gray-200"
              />
              <span className="text-xs text-gray-600">days</span>
            </div>
          )}
        </>
      )}

      {/* Export recruits */}
      <button
        type="button"
        onClick={() => exportRecruitsToExcel(sorted, { isAdmin: mode === "admin" })}
        className="bg-[#fff200] text-black font-extrabold px-3 py-2 rounded-md border border-black/10 hover:brightness-95"
      >
        Export Recruits to Excel
      </button>

      {/* Month picker + CYA */}
      <input
        type="month"
        value={cyaMonth}
        onChange={(e) => setCyaMonth(e.target.value)}
        className="px-3 py-2 rounded-md border border-gray-200"
        title="Choose month for CYA export"
      />

<button
  type="button"
  onClick={async () => {
    try {
      const [y, m] = String(cyaMonth).split("-").map(Number);

      // ✅ use props directly (NOT a local useAuth)
      const u = currentUser;
      const p = currentProfile;

      if (!u) {
        alert("You must be signed in to export.");
        return;
      }

     const isAdmin = p?.role === "admin";

await exportMonthlyCyaToExcel({
  year: y,
  month: m,
  user: u,
  profile: p,

  admin: isAdmin,
  scope: isAdmin ? "self" : "self", // default both to self
});

    } catch (e) {
      console.error("Monthly CYA export failed:", e);
      alert(e?.message || "Monthly CYA export failed. Check console.");
    }
  }}
  className="bg-[#fff200] text-black font-extrabold px-3 py-2 rounded-md border border-black/10 hover:brightness-95"
>
  Export Monthly CYA
</button>

    </div>
  </div>

  {/* row 2: search + density */}
  <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
    <input
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Search name, email, phone, status, office..."
      className="w-full md:w-[360px] px-3 py-2 rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-wrcYellowUI)]"
    />

    <button
      type="button"
      onClick={() => setDense((v) => !v)}
      className="px-3 py-2 rounded-full border border-gray-200 text-sm bg-white hover:bg-gray-50"
      title="Toggle row density"
    >
      Row density: {dense ? "Compact" : "Comfortable"}
    </button>
  </div>
</div>


      {/* table */}
      <div className="border-t border-gray-100 flex-1 min-h-0 flex flex-col">
        {/* TOP horizontal scrollbar */}
        <div
          ref={topScrollRef}
          className="sticky top-0 z-30 overflow-x-auto overflow-y-hidden border-b border-gray-100 bg-white"
          onScroll={() => {
            if (!topScrollRef.current || !tableScrollRef.current) return;
            tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
          }}
        >
          <div style={{ width: topScrollWidth, height: 12 }} />
        </div>

        {/* MAIN table scroll container */}
        <div
          ref={tableScrollRef}
          className="flex-1 min-h-0 overflow-auto"
          onScroll={() => {
            if (!topScrollRef.current || !tableScrollRef.current) return;
            topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
          }}
        >
          {/* widen base min-width slightly for checkbox column */}
          <table ref={tableRef} className="w-full min-w-[2100px] border-collapse">
    

            {/* We need the NAME/CONTACT headers as real <th> so we can apply style.left.
                So we rebuild header row fully (minimal changes). */}
            <thead className="sticky top-[12px] bg-white z-20">
              <tr className="border-b border-gray-100">
                {isAdmin && (
                  <th
                    className="text-left px-3 py-3 text-xs font-bold text-gray-600 sticky left-0 bg-white z-40 border-r border-gray-100 w-[48px] min-w-[48px]"
                    title="Select all"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={sorted.length > 0 && selectedIds.length === sorted.length}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleAll();
                      }}
                    />
                  </th>
                )}

                {/* Sticky NAME with sort */}
                <th
                  onClick={() => toggleSort("name")}
                  className={`text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50 sticky bg-white z-30 border-r border-gray-100 w-[320px] min-w-[320px]`}
                  style={{ left: nameLeft }}
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    NAME
                    {sortKey === "name" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>

                {/* Sticky CONTACT */}
                <th
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 sticky bg-white z-30 border-r border-gray-100 w-[280px] min-w-[280px]"
                  style={{ left: contactLeft }}
                >
                  CONTACT
                </th>
                         <th
                  onClick={() => toggleSort("updatedAt")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    UPDATED
                    {sortKey === "updatedAt" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>
{/* ✅ LATEST ACTIVITY (moved next to Contact) */}
<th className="text-left px-4 py-3 text-xs font-bold text-gray-600">
  LATEST ACTIVITY
</th>
<th
  onClick={() => toggleSort("actionItemDueAt")}
  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
  title="Click to sort"
>
  <div className="inline-flex items-center gap-1">
    ACTION ITEM DUE
    {sortKey === "actionItemDueAt" ? (
      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
    ) : null}
  </div>
</th>
                <th
                  onClick={() => toggleSort("currentOffice")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  
                  <div className="inline-flex items-center gap-1">
                    CURRENT OFFICE
                    {sortKey === "currentOffice" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>

                <th
                  onClick={() => toggleSort("potential")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    POTENTIAL
                    {sortKey === "potential" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>

                <th
                  onClick={() => toggleSort("yearsInIndustry")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    YRS INDUSTRY
                    {sortKey === "yearsInIndustry" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>

                <th
                  onClick={() => toggleSort("yearsInOffice")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    YRS OFFICE
                    {sortKey === "yearsInOffice" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>

                <th
                  onClick={() => toggleSort("ltmSalesVolume")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    LTM SALES
                    {sortKey === "ltmSalesVolume" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>

                <th
                  onClick={() => toggleSort("ltmSalesVolumeGrowthPct")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    LTM GROWTH
                    {sortKey === "ltmSalesVolumeGrowthPct" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>
<th
  onClick={() => toggleSort("levelOfUrgency")}
  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
  title="Click to sort"
>
  <div className="inline-flex items-center gap-1">
    LEVEL OF URGENCY
    {sortKey === "levelOfUrgency" ? (
      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
    ) : null}
  </div>
</th>

<th
  onClick={() => toggleSort("level")}
  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
  title="Click to sort"
>
  <div className="inline-flex items-center gap-1">
    PHASE
    {sortKey === "level" ? (
      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
    ) : null}
  </div>
</th>

                <th
                  onClick={() => toggleSort("status")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    STATUS
                    {sortKey === "status" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>

                <th
                  onClick={() => toggleSort("relationshipRank")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    RELATIONSHIP
                    {sortKey === "relationshipRank" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>

                <th
                  onClick={() => toggleSort("urgencyRank")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    URGENCY
                    {sortKey === "urgencyRank" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th>

                {/* <th
                  onClick={() => toggleSort("nextFollowUpAt")}
                  className="text-left px-4 py-3 text-xs font-bold text-gray-600 select-none cursor-pointer hover:bg-gray-50"
                  title="Click to sort"
                >
                  <div className="inline-flex items-center gap-1">
                    NEXT FOLLOW-UP
                    {sortKey === "nextFollowUpAt" ? (
                      <span className="text-gray-400">{sortDir === "asc" ? "▲" : "▼"}</span>
                    ) : null}
                  </div>
                </th> */}

                {isAdmin && (
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-600">
                    ASSIGNED AGENT
                  </th>
                )}

                {/* <th className="text-left px-4 py-3 text-xs font-bold text-gray-600">
                  LATEST ACTIVITY
                </th> */}

       
              </tr>
            </thead>

            <tbody>
              {sorted.map((r) => {
                const name =
                  r.fullName ||
                  `${r.firstName || ""} ${r.lastName || ""}`.trim() ||
                  r.email ||
                  "Unnamed recruit";

                const relKey = `${r.id}:relationshipRank`;
                const urgKey = `${r.id}:urgencyRank`;

                return (
                 <tr
  key={r.id}
  className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${
    getActionItemDueMeta(r.actionItemDueAt).tone === "overdue"
      ? "bg-red-50/40"
      : getActionItemDueMeta(r.actionItemDueAt).tone === "today"
      ? "bg-orange-50/40"
      : ""
  }`}
  onClick={() => onOpenRecruit?.(r)}
>
                    {/* ✅ Sticky SELECT (admin only) */}
                    {isAdmin && (
                      <td
                        className={`px-3 ${rowPad} align-top sticky left-0 bg-white z-30 border-r border-gray-100 w-[48px] min-w-[48px]`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(r.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleOne(r.id);
                          }}
                        />
                      </td>
                    )}

                    {/* Sticky NAME */}
                    <td
                      className={`px-4 ${rowPad} align-top sticky bg-white z-20 border-r border-gray-100 w-[320px] min-w-[320px]`}
                      style={{ left: nameLeft }}
                    >
                      <div className={`font-semibold text-[var(--color-wrcBlack)] ${cellText}`}>
                        {name}
                      </div>
                      <div className="text-xs text-gray-500">
                        Created: {tsToText(r.createdAt) || "—"}
                      </div>
                    </td>

                    {/* Sticky CONTACT */}
                    <td
                      className={`px-4 ${rowPad} align-top sticky bg-white z-20 border-r border-gray-100 w-[280px] min-w-[280px]`}
                      style={{ left: contactLeft }}
                    >
                      <div className={`text-gray-800 ${cellText}`}>
  {formatPhone(r.phone)}
</div>
                      <div className="text-xs text-blue-700">{r.email || "—"}</div>
                    </td>
                    <td className={`px-4 ${rowPad} align-top`}>
                      <div className={`text-gray-800 ${cellText}`}>{tsToDateTime(r.lastTouchedAt || r.updatedAt) || ""}
</div>
                    </td>
{/* ✅ LATEST ACTIVITY (moved next to Contact) */}
<td className={`px-4 ${rowPad} align-top`}>
  <div className={`font-semibold text-gray-900 ${cellText}`}>
    {r.lastActivityText || "—"}
  </div>
  <div className="text-xs text-gray-500">
    {tsToDateTime(r.lastActivityAt) || ""}
  </div>
</td>
<td className={`px-4 ${rowPad} align-top`}>
  {(() => {
    const dueMeta = getActionItemDueMeta(r.actionItemDueAt);

    return (
      <span
        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${dueMeta.className}`}
      >
        {dueMeta.label}
      </span>
    );
  })()}
</td>

                    <td className={`px-4 ${rowPad} align-top`}>
                      <div className={`text-gray-900 ${cellText}`}>{r.currentOffice || "—"}</div>
                    </td>

                    <td className={`px-4 ${rowPad} align-top`}>
                      <Pill
                        tone={
                          r.potential
                            ? String(r.potential).toLowerCase() === "high"
                              ? "red"
                              : "gray"
                            : "gray"
                        }
                      >
                        {r.potential || "—"}
                      </Pill>
                    </td>

                    <td className={`px-4 ${rowPad} align-top`}>
                      <div className={`text-gray-900 ${cellText}`}>
                        {Number.isFinite(Number(r.yearsInIndustry)) ? Number(r.yearsInIndustry) : "—"}
                      </div>
                    </td>

                    <td className={`px-4 ${rowPad} align-top`}>
                      <div className={`text-gray-900 ${cellText}`}>
                        {Number.isFinite(Number(r.yearsInOffice)) ? Number(r.yearsInOffice) : "—"}
                      </div>
                    </td>

                    <td className={`px-4 ${rowPad} align-top`}>
                      <div className={`text-gray-900 ${cellText}`}>{formatMoney(r.ltmSalesVolume)}</div>
                    </td>

                    <td className={`px-4 ${rowPad} align-top`}>
                      <Pill
                        tone={
                          Number.isFinite(Number(r.ltmSalesVolumeGrowthPct))
                            ? Number(r.ltmSalesVolumeGrowthPct) >= 0
                              ? "green"
                              : "red"
                            : "gray"
                        }
                      >
                        {formatPct(r.ltmSalesVolumeGrowthPct)}
                      </Pill>
                    </td>
                <td className={`px-4 ${rowPad} align-top`}>
  <Pill tone={urgencyLevelTone(r.levelOfUrgency)}>
    {urgencyLevelLabelForGrid(r.levelOfUrgency)}
  </Pill>
</td>
<td className={`px-4 ${rowPad} align-top`}>
  <Pill tone={toneForPhase(r.level)}>{phaseLabelForGrid(r.level)}</Pill>
</td>

                    <td className={`px-4 ${rowPad} align-top`}>
                      <Pill tone="blue">{r.status || "—"}</Pill>
                    </td>

                    {/* RELATIONSHIP inline edit */}
                    <td className={`px-4 ${rowPad} align-top`}>
                      <select
                        value={r.relationshipRank || "0% or new lead"}
                        disabled={savingKey === relKey}
                        onClick={(e) => e.stopPropagation()}
                        onChange={async (e) => {
                          e.stopPropagation();
                          const next = e.target.value;
                          await updateRecruitField(
                            r,
                            { relationshipRank: next },
                            `${mode === "admin" ? "Admin" : "Agent"} updated relationship ranking to "${next}".`
                          );
                        }}
                        className="w-full max-w-[220px] px-2 py-1.5 rounded-md border border-gray-200 text-sm bg-white"
                      >
                        {RELATIONSHIP_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                      <div className="mt-1">
                        <Pill>{r.relationshipRank || "—"}</Pill>
                      </div>
                    </td>

                    {/* URGENCY inline edit */}
                    <td className={`px-4 ${rowPad} align-top`}>
                      <select
                        value={r.urgencyRank || "Not sure"}
                        disabled={savingKey === urgKey}
                        onClick={(e) => e.stopPropagation()}
                        onChange={async (e) => {
                          e.stopPropagation();
                          const next = e.target.value;
                          await updateRecruitField(
                            r,
                            { urgencyRank: next },
                            `${mode === "admin" ? "Admin" : "Agent"} updated urgency likelihood to "${next}".`
                          );
                        }}
                        className="w-full max-w-[220px] px-2 py-1.5 rounded-md border border-gray-200 text-sm bg-white"
                      >
                        {URGENCY_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>

                      <div className="mt-1">
                        <Pill tone={toneForUrgency(r.urgencyRank)}>{r.urgencyRank || "—"}</Pill>
                      </div>
                    </td>

                    {/* <td className={`px-4 ${rowPad} align-top`}>
                      {(() => {
                        const meta = followUpMeta(r.nextFollowUpAt);
                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Pill tone={meta.tone}>
                                <span className="font-extrabold">Follow-up:</span>&nbsp;{meta.label}
                              </Pill>
                            </div>
                            {meta.sub ? <div className="text-xs text-gray-500">{meta.sub}</div> : null}
                          </div>
                        );
                      })()}
                    </td> */}

                    {isAdmin && (
                      <td className={`px-4 ${rowPad} align-top`}>
                        <div className={`text-gray-900 ${cellText}`}>{r.assignedAgentName || "—"}</div>
                        <div className="text-xs text-gray-500">{r.assignedAgentEmail || ""}</div>
                      </td>
                    )}

                    {/* <td className={`px-4 ${rowPad} align-top`}>
                      <div className={`font-semibold text-gray-900 ${cellText}`}>
                        {r.lastActivityText || "—"}
                      </div>
                      <div className="text-xs text-gray-500">{tsToDateTime(r.lastActivityAt) || ""}</div>
                    </td> */}

                    
                  </tr>
                );
              })}

              {sorted.length === 0 && (
                <tr>
                 <td colSpan={isAdmin ? 18 : 16} className="px-4 py-8 text-sm text-gray-600">
                    No recruits match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
