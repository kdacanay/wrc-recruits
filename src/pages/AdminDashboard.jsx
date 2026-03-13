import React, { useEffect, useState, useMemo} from "react";
import { signOut } from "firebase/auth";
import { auth, db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  Timestamp,
  limit,
  updateDoc,
} from "firebase/firestore";
import RecruitGrid from "../components/RecruitGrid";
import Papa from "papaparse";
import { docIdFromEmail } from "../utils/docIdFromEmail";
import { getFunctions, httpsCallable } from "firebase/functions";
import AdminAddRecruitForm from "../components/AdminAddRecruitForm";
import { normalizeRecruitStatus } from "../utils/normalizeRecruitStatus";
import { STATUS_OPTIONS } from "../constants/recruitOptions";
import { urgencyLevelPillLabel } from "../utils/urgencyLevel";
import { levelToPhase } from "../utils/phaseLevel";


function CollapsibleCard({
  title,
  subtitle,
  defaultOpen = false,
  actions,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-gray-50"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="text-lg font-extrabold text-[var(--color-wrcBlack)] truncate">
              {title}
            </span>
            {subtitle ? (
              <span className="text-sm text-gray-500 truncate">{subtitle}</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {actions ? <div onClick={(e) => e.stopPropagation()}>{actions}</div> : null}

          <span
            className={`transition-transform duration-200 text-gray-500 ${
              open ? "rotate-180" : "rotate-0"
            }`}
            aria-hidden="true"
          >
            ▼
          </span>
        </div>
      </button>

      {open && <div className="px-5 pb-5">{children}</div>}
    </section>
  );
}
function fmtLevel(v) {
  return levelToPhase(v) || "—";
}
function normPhone(v) {
  return String(v || "").trim();
}

function splitName(full) {
  const s = String(full || "").trim();
  if (!s) return { first: null, last: null };

  // handles "Jonathan (Jon) Baker" reasonably
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}
function assignedKey(r) {
  const uid = String(r?.assignedAgentUid || "").trim();
  if (uid) return uid;

  const email = String(r?.assignedAgentEmail || "").trim().toLowerCase();
  if (email) return email;

  return "unassigned";
}
function fmtTs(ts) {
  if (!ts) return "";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "";
  }
}
function getAlertMessage(a) {
  // 1) Prefer explicit text fields if present
  if (a?.text) return a.text;
  if (a?.message) return a.message;
  if (a?.activityText) return a.activityText;
  if (a?.eventText) return a.eventText;

  // 2) Derive from changes[] (your source of truth)
  const changes = Array.isArray(a?.changes) ? a.changes : [];
  if (changes.length) {
    const parts = changes
      .map((c) => {
        if (!c?.field) return null;
if (c.field === "level" || c.field === "phase") {
  return `Phase changed from "${fmtLevel(c.from)}" to "${fmtLevel(c.to)}"`;
}
if (c.field === "levelOfUrgency") {
  return `Scheduling Priority Level changed from "Level ${c.from ?? "—"}" to "Level ${c.to ?? "—"}"`;
}
        if (c.field === "status") {
          return `Status changed from "${c.from ?? "blank"}" to "${c.to ?? "blank"}"`;
        }
        if (c.field === "relationshipRank") {
          return `Relationship updated to "${c.to ?? "blank"}"`;
        }
        if (c.field === "urgencyRank") {
          return `Urgency updated to "${c.to ?? "blank"}"`;
        }

        // fallback
        return `${c.field} updated`;
      })
      .filter(Boolean);

    if (parts.length) return parts.join(" • ");
  }

  return "Alert";
}
function adminTouchTone(name, currentAdminName) {
  const a = String(name || "").trim().toLowerCase();
  const b = String(currentAdminName || "").trim().toLowerCase();

  if (!a) return "gray";
  if (a === b) return "blue";
  return "orange";
}
function toDateSafe(ts) {
  if (!ts) return null;
  try {
    return ts.toDate ? ts.toDate() : new Date(ts);
  } catch {
    return null;
  }
}
function SmallBadge({ children, tone = "gray" }) {
  const base =
    "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border";
  const tones = {
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    gray: "bg-gray-50 border-gray-200 text-gray-700",
    orange: "bg-orange-50 border-orange-200 text-orange-800",
    green: "bg-green-50 border-green-200 text-green-800",
    red: "bg-red-50 border-red-200 text-red-800",
  };

  return <span className={`${base} ${tones[tone] || tones.gray}`}>{children}</span>;
}
function toYmdLocal(dateLike) {
  const d = dateLike instanceof Date ? dateLike : toDateSafe(dateLike);
  if (!d || Number.isNaN(d.getTime())) return null;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

export default function AdminDashboard() {
  const [showUnreadOnly, setShowUnreadOnly] = useState(true);
const location = useLocation();
const [addRecruitOpen, setAddRecruitOpen] = useState(false);
  const { user, profile, loading} = useAuth();
  const navigate = useNavigate();

  const [agents, setAgents] = useState([]);
  const [recruits, setRecruits] = useState([]);

  const [selectedRecruitIds, setSelectedRecruitIds] = useState([]);
  const [filteredRecruitIds, setFilteredRecruitIds] = useState([]);

  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [snapshotModal, setSnapshotModal] = useState({
  open: false,
  title: "",
  rows: [],
});

  const [csvFile, setCsvFile] = useState(null);

  const headerBlack = "text-[var(--color-wrcBlack)]";
  const stripeYellow = "bg-[var(--color-wrcYellowUI)]";

  const officeLabel =
    profile?.office?.replace(/([A-Z])/g, " $1").trim() || "Office not set";

  async function handleLogout() {
    await signOut(auth);
    navigate("/login", { replace: true });
  }

const recruitNameById = useMemo(() => {
  const m = new Map();
  for (const r of recruits || []) {
    const name =
      (r.fullName || "").trim() ||
      `${r.firstName || ""} ${r.lastName || ""}`.trim() ||
      (r.email || "").trim() ||
      r.id;
    if (r?.id) m.set(r.id, name || r.id);
  }
  return m;
}, [recruits]);

useEffect(() => {
  if (loading) return;
  if (!user?.uid) return;

  const q = query(collectionGroup(db, "activity"), limit(10));

  return onSnapshot(
    q,
    (snap) => {
      console.log("🔎 activity docs found:", snap.size);
      snap.docs.forEach((d) => console.log(" -", d.ref.path, d.data()));
    },
    (err) => console.error("❌ activity debug listener error:", err)
  );
}, [loading, user?.uid]);

useEffect(() => {
  if (loading) return;
  if (!user?.uid) return;

  const uref = doc(db, "users", user.uid);
  return onSnapshot(
    uref,
    (s) => console.log("✅ can read my user doc", s.exists(), s.data()),
    (e) => console.error("❌ cannot read my user doc", e)
  );
}, [loading, user?.uid]);

useEffect(() => {
  const saved = location.state?.dashboardState;
  if (!saved) return;

  if (saved.selectedRecruitIds) setSelectedRecruitIds(saved.selectedRecruitIds);
  if (saved.filteredRecruitIds) setFilteredRecruitIds(saved.filteredRecruitIds);

  if (saved.snapshotModal) {
    setSnapshotModal(saved.snapshotModal);
  }

  if (typeof saved.scrollY === "number") {
    setTimeout(() => window.scrollTo(0, saved.scrollY), 0);
  }
}, []);

const [snapshotClosing, setSnapshotClosing] = useState(false);
  // -------- USERS (agents/managers) ----------
  useEffect(() => {
    const ref = collection(db, "users");
    const q = query(ref, where("role", "in", ["manager", "agent"]));

    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) =>
        String(a.fullName || a.email || "").localeCompare(
          String(b.fullName || b.email || "")
        )
      );
      setAgents(rows);
    });

    return () => unsub();
  }, []);
// -------- RECRUITS (main grid) ----------
useEffect(() => {
  if (loading) return;
  if (!user?.uid) return;

  const q = query(
    collection(db, "recruits"),
    orderBy("createdAt", "desc") // or updatedAt if you prefer
  );

  const unsub = onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRecruits(rows);
    },
    (err) => console.error("recruits listener error:", err)
  );

  return () => unsub();
}, [loading, user?.uid]);


useEffect(() => {
  if (loading) return;
  if (!user?.uid) return;
  if (profile?.role !== "admin") return;

  const constraints = [
    orderBy("createdAt", "desc"),
    limit(200),
    ...(showUnreadOnly ? [where("unreadByAdmins", "==", true)] : []),
  ];

  const q = query(collectionGroup(db, "activity"), ...constraints);

  const unsub = onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({
        id: d.id,
        refPath: d.ref.path,
        ...d.data(),
      }));

      setAlerts(rows);
      setUnreadCount(rows.filter((x) => x.unreadByAdmins === true).length);
    },
    (err) => console.error("activity listener error:", err)
  );

  return () => unsub();
}, [loading, user?.uid, profile?.role, showUnreadOnly]);

function openSnapshotModal(type, value = "") {
  const rows = (recruits || []).filter((r) => {
    const normalizedStatus = normalizeRecruitStatus(r.status);
    const phase = levelToPhase(r.level);

    switch (type) {
      case "recruited":
        return normalizedStatus === "Recruited";

      case "meetingScheduled":
        return normalizedStatus === "Meeting scheduled";

      case "meetingHeld":
        return normalizedStatus === "Meeting held";

      case "status":
        return normalizedStatus === String(value || "").trim();

      case "phase":
        return phase === String(value || "").trim();

      case "priority":
  return Number(r.levelOfUrgency || 1) === Number(value);

      default:
        return false;
    }
  });

  const sortedRows = [...rows].sort((a, b) => {
    const aName = a.fullName || a.email || "";
    const bName = b.fullName || b.email || "";
    return aName.localeCompare(bName);
  });

  let title = "Filtered recruits";
  if (type === "recruited") title = "Recruited";
  if (type === "meetingScheduled") title = "Meeting Scheduled";
  if (type === "meetingHeld") title = "Meeting Held";
  if (type === "status") title = value || "Status";
  if (type === "phase") title = value || "Phase";
  if (type === "priority") title = `Level ${value}`;

  setSnapshotModal({
    open: true,
    title,
    rows: sortedRows,
  });
}




async function handleClearAlert(alertObj) {
  if (!alertObj?.refPath) return;

  try {
    await updateDoc(doc(db, ...alertObj.refPath.split("/")), {
      unreadByAdmins: false,
      readAt: serverTimestamp(),
      readByUid: user?.uid || null,
    });
  } catch (e) {
    console.error("mark alert read failed:", e);
    alert(e.message || "Could not mark alert read. Check console.");
  }
}




  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // ----------------- CSV HELPERS -----------------
  function normEmail(v) {
    return String(v || "").trim().toLowerCase();
  }

  function cleanStr(v) {
    const s = String(v ?? "").trim();
    return s.length ? s : null;
  }
function getEmailFromRow(r) {
  return normEmail(r["Email"] || r["Agent Email"] || r["email"] || r["AgentEmail"]);
}

  function toNumberOrNull(v) {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const n = Number(s.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function parsePercentToNumberOrNull(v) {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const cleaned = s.endsWith("%") ? s.slice(0, -1) : s;
    const n = Number(cleaned.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function parseDateAny(v) {
    const s = String(v ?? "").trim();
    if (!s) return null;

    const iso = Date.parse(s);
    if (!Number.isNaN(iso) && /T.*Z$/.test(s)) return new Date(iso);

    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
    if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));

    const ymd = s.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
    if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));

    return null;
  }

  function getRowBaseDate(r) {
    const d1 = parseDateAny(r["Last Interaction Date"]);
    if (d1) return d1;

    const d2 = parseDateAny(r["Added Date"]);
    if (d2) return d2;

    return new Date();
  }

  function closeSnapshotDrawer() {
  setSnapshotClosing(true);

  setTimeout(() => {
    setSnapshotModal({ open: false, title: "", rows: [] });
    setSnapshotClosing(false);
  }, 250);
}

  function detectDelimiter(file, onDelimiter) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const sample = text.slice(0, 4096);
      const tabCount = (sample.match(/\t/g) || []).length;
      const commaCount = (sample.match(/,/g) || []).length;
      onDelimiter(tabCount > commaCount ? "\t" : ",");
    };
    reader.readAsText(file);
  }


function isMonthHeading(line) {
  return /^[A-Za-z]+\s+\d{4}$/.test(line.trim()); // "August 2025"
}

function tryParseHistoryDate(line) {
  const d = new Date(line);
  return isNaN(d.getTime()) ? null : d;
}

function parseSharePointHistory(history) {
  if (!history) return [];
  const lines = String(history)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isMonthHeading(line)) continue;

    const d = tryParseHistoryDate(line);
    if (!d) continue;

    const action = lines[i - 1] || "Interaction";
    const name = lines[i - 2] || "Recruiting Team";

    const text = `${name} — ${action}`.trim();
    out.push({ date: d, text });
  }

  return out;
}

  function formatCourtedNote(raw) {
    const input = String(raw ?? "").trim();
    if (!input) return null;

    let t = input;

    t = t.replace(/\r\n/g, "\n");
    t = t.replace(/[ \t]+\n/g, "\n");
    t = t.replace(/\n{3,}/g, "\n\n");
    t = t.replace(/[ \t]{2,}/g, " ");

    t = t.replace(/([.!?])([A-Z])/g, "$1 $2");

    t = t.replace(/(\b(?:AM|PM))\s*Today\b/g, "$1\nToday");
    t = t.replace(/\bToday(?=[A-Z])/g, "Today\n");
    t = t.replace(/(Yesterday,?\s*\d{1,2}:\d{2}\s*(AM|PM))/gi, "\n$1");
    t = t.replace(/(\b\d{1,2}:\d{2}\s*(AM|PM)\b)/gi, "\n$1");

    t = t.replace(/\s*(My text thread:|Text thread:)\s*/gi, "\nText thread:\n");

    t = t.replace(
      /([A-Za-z][A-Za-z .'-]{1,60})\s*(\(\d{3}\)\s*\d{3}[-.\s]?\d{4})\s*(?=[A-Za-z])/g,
      "$1 $2\n"
    );

    t = t.replace(
      /(\S)(Yes interested|Yes|No|Thanks|Thank you|Ok|Okay)\b/gi,
      "$1\n$2"
    );

    t = t.replace(/\n{3,}/g, "\n\n").trim();

    const looksLikeThread =
      /\bYesterday\b|\bToday\b|\b\d{1,2}:\d{2}\s*(AM|PM)\b/i.test(t);

    if (looksLikeThread) {
      const firstMarkerIdx = t.search(/\bYesterday\b|\bToday\b|\b\d{1,2}:\d{2}\s*(AM|PM)\b/i);
      if (firstMarkerIdx > 120) {
        const intro = t.slice(0, firstMarkerIdx).trim();
        const rest = t.slice(firstMarkerIdx).trim();
        const introNoThread = intro.replace(/\n?Text thread:\n?/i, "").trim();
        t = `${introNoThread}\n\n---\nText thread:\n${rest}`;
      } else if (!/^Text thread:/i.test(t)) {
        t = `Text thread:\n${t}`;
      }
    }

    return t;
  }

  // ----------------- CSV IMPORT -----------------
  async function handleImportCsv(file) {
    if (!file) return;

    const agentByName = new Map(
      (agents || [])
        .filter((a) => a?.fullName)
        .map((a) => [String(a.fullName).trim().toLowerCase(), a])
    );

    detectDelimiter(file, (delimiter) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        delimiter,
        complete: async (results) => {
const rows = results.data || [];
const fields = results.meta?.fields || [];
const isSharePoint =
  fields.includes("Full Interaction History") ||
  fields.includes("Agent Name") ||
  fields.includes("Agent Email");

const importedFrom = isSharePoint ? "SharePoint CSV" : "Courted CSV";

if (!rows.length) {
  alert("No rows found in CSV.");
  return;
}

// ---- PRECHECK #1: duplicate emails in the file (BLOCK) ----
const emailToRowNums = new Map();
const dupEmails = [];

rows.forEach((r, i) => {
  const email = getEmailFromRow(r); // ✅ use your helper
  if (!email) return;
  const arr = emailToRowNums.get(email) || [];
  arr.push(i + 2);
  emailToRowNums.set(email, arr);
});

for (const [email, idxs] of emailToRowNums.entries()) {
  if (idxs.length > 1) dupEmails.push({ email, rows: idxs });
}

if (dupEmails.length) {
  const preview = dupEmails
    .slice(0, 20)
    .map((d) => `${d.email} rows ${d.rows.join(", ")}`)
    .join("\n");

  alert(
    "Import blocked: duplicate Email(s) found in this file.\n\n" +
      preview +
      (dupEmails.length > 20 ? "\n...and more" : "")
  );
  return;
}


          try {
            let batch = writeBatch(db);
            let ops = 0;



            
            const commitIfNeeded = async () => {
              if (ops >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                ops = 0;
              }
            };

            for (const r of rows) {
  const emailRaw = getEmailFromRow(r);
if (!emailRaw) continue;

const recruitId = docIdFromEmail(emailRaw);
const recruitRef = doc(db, "recruits", recruitId);

// ---- Name (Courted or SharePoint) ----
const spName = cleanStr(r["Agent Name"]);
const cFirst = cleanStr(r["First Name"]);
const cLast = cleanStr(r["Last Name"]);

let firstNameFinal = cFirst;
let lastNameFinal = cLast;

if ((!firstNameFinal && !lastNameFinal) && spName) {
  const parts = splitName(spName);
  firstNameFinal = parts.first;
  lastNameFinal = parts.last;
}

const fullNameFinal =
  cleanStr(`${firstNameFinal || ""} ${lastNameFinal || ""}`.trim()) ||
  spName ||
  null;

// ---- Phone ----
const phoneFinal = cleanStr(r["Phone"] || r["Agent Phone"] || r["phone"]);

// ---- Office/Brokerage ----
const currentOffice = cleanStr(r["Current Office"] || r["Brokerage"]);

// ---- Status ----
const statusRaw = cleanStr(r["Status"]);
const status = normalizeRecruitStatus(statusRaw) || (isSharePoint ? "Prospecting" : "Identified (from Courted)");

// ---- Rankings (SharePoint only; keep defaults otherwise) ----
const relationshipRank =
  cleanStr(r["Relationship Ranking"]) || (isSharePoint ? null : "0% or new lead");

const urgencyRank =
  cleanStr(r["Urgency Ranking"]) || (isSharePoint ? null : "Not sure");

// ---- Assigned To (Courted: Assigned To; SharePoint: Recruiter) ----
const assignedToNameRaw = cleanStr(r["Assigned To"] || r["Recruiter"]) || "";
const a = assignedToNameRaw
  ? agentByName.get(assignedToNameRaw.toLowerCase())
  : null;

// ---- Dates ----
const lastInteractionDate = parseDateAny(r["Last Interaction Date"]) || parseDateAny(r["Engagement Date"]) || parseDateAny(r["First Attempt Date"]);
const lastInteractionMs = lastInteractionDate ? lastInteractionDate.getTime() : null;

const nextEvaluationDate = parseDateAny(r["Next Evaluation"] || r["Next Evaluation Date"]);
const nextEvaluationMs = nextEvaluationDate ? nextEvaluationDate.getTime() : null;

// ---- Courted extras ----
const potential = cleanStr(r["Potential to Move"]) || null;
const source = cleanStr(r["Source"]) || (isSharePoint ? "SharePoint" : "Courted");

const yearsInIndustry = toNumberOrNull(r["Years in Industry"]);
const ltmSalesVolume = toNumberOrNull(r["LTM Sales Volume"]);
const ltmSalesVolumeGrowthPct = parsePercentToNumberOrNull(r["LTM Sales Volume % Growth"]);
const yearsInOffice = toNumberOrNull(r["Years in Office"]);

// ---- SharePoint extras ----
const engagementLevel = cleanStr(r["Engagement Level"]);
const engagementDate = parseDateAny(r["Engagement Date"]);
const firstAttemptDate = parseDateAny(r["First Attempt Date"]);
const projectedSalesVolume = cleanStr(r["Projected Sales Volume"]);
const likelihoodToWcr = cleanStr(r["Likelihood to WCR Ranking"]);
const coBrokeAgent = cleanStr(r["Co-Broke Agent"]);
const coBrokeLocation = cleanStr(r["Co-Broke Location"]);
const sharepointId = cleanStr(r["ID"]);

batch.set(
  recruitRef,
  {
    firstName: firstNameFinal || null,
    lastName: lastNameFinal || null,
    fullName: fullNameFinal || null,
    email: emailRaw,
    phone: phoneFinal || null,

    status,
    relationshipRank: relationshipRank || "0% or new lead",
    urgencyRank: urgencyRank || "Not sure",
    levelOfUrgency: 1,
    source,

    office: profile?.office || null,
    currentOffice: currentOffice || null,
    potential,

    // Assignment
    assignedOffice: a?.office || null,
    assignedAgentUid: a?.id || null,
    assignedAgentName: a?.fullName || (assignedToNameRaw || null),
    assignedAgentEmail: a?.email || null,
    assignedAt: a ? serverTimestamp() : null,
    assignedByUid: a ? (user?.uid || null) : null,

    // Dates
    lastInteractionAt: lastInteractionDate ? Timestamp.fromDate(lastInteractionDate) : null,
    lastInteractionMs,

    nextEvaluationAt: nextEvaluationDate ? Timestamp.fromDate(nextEvaluationDate) : null,
    nextEvaluationMs,

    // SharePoint fields (stored only if present)
    engagementLevel: engagementLevel || null,
    engagementAt: engagementDate ? Timestamp.fromDate(engagementDate) : null,
    engagementMs: engagementDate ? engagementDate.getTime() : null,

    firstAttemptAt: firstAttemptDate ? Timestamp.fromDate(firstAttemptDate) : null,
    firstAttemptMs: firstAttemptDate ? firstAttemptDate.getTime() : null,

    projectedSalesVolume: projectedSalesVolume || null,
    likelihoodToWcrRanking: likelihoodToWcr || null,
    coBrokeAgent: coBrokeAgent || null,
    coBrokeLocation: coBrokeLocation || null,
    sharepointId: sharepointId || null,

    lastActivityText: `Admin imported recruit from ${importedFrom}`,
    lastActivityAt: serverTimestamp(),

    importedAt: serverTimestamp(),
    importedFrom,

    createdVia: "import",
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  },
  { merge: true }
);

              ops++;
              await commitIfNeeded();

// ---- Courted notes (Note 1-3) ----
const courtedNotes = [
  { col: "Note 1", raw: r["Note 1"], offsetMs: 2000, id: "csv-note1" },
  { col: "Note 2", raw: r["Note 2"], offsetMs: 1000, id: "csv-note2" },
  { col: "Note 3", raw: r["Note 3"], offsetMs: 0, id: "csv-note3" },
];

const baseDate = getRowBaseDate(r);
const baseMs = baseDate.getTime();

// Courted-style notes (deterministic IDs)
for (const n of courtedNotes) {
  const cleaned = formatCourtedNote(cleanStr(n.raw));
  if (!cleaned) continue;

  const entryRef = doc(db, "recruits", recruitId, "journal", n.id);
  const createdAtMs = baseMs + n.offsetMs;

  batch.set(
    entryRef,
    {
      text: cleaned,
      authorUid: user?.uid || null,
      authorName: profile?.fullName || user?.email || "Admin",
      authorRole: "admin",

      createdAt: Timestamp.fromMillis(createdAtMs),
      createdAtMs,

      importedFrom,
      csvColumn: n.col,
      importedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  ops++;
  await commitIfNeeded();
}

// SharePoint history → multiple journal entries (deterministic IDs)
if (isSharePoint) {
  const hist = r["Full Interaction History"];
  const entries = parseSharePointHistory(hist);

  for (const e of entries) {
    const createdAtMs = e.date.getTime();

    // deterministic doc id so reimport won’t duplicate:
    const safe = String(e.text || "").slice(0, 80).replace(/[^\w]+/g, "-").toLowerCase();
    const jid = `sp-${createdAtMs}-${safe}`;

    const entryRef = doc(db, "recruits", recruitId, "journal", jid);

    batch.set(
      entryRef,
      {
        text: e.text,
        authorUid: user?.uid || null,
        authorName: "SharePoint Import",
        authorRole: "admin",

        createdAt: Timestamp.fromMillis(createdAtMs),
        createdAtMs,

        importedFrom,
        csvColumn: "Full Interaction History",
        importedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    ops++;
    await commitIfNeeded();
  }
}
            }

          if (ops > 0) await batch.commit();

// ✅ Replace old success alert with this:
if (ops === 0) {
  alert(
    "No recruits were imported.\n\nMost likely: the email column header didn’t match (expected 'Email' or 'Agent Email')."
  );
} else {
  alert(
    `CSV import complete.\n\n${Math.floor(ops / 4)} recruit(s) processed.`
  );
}

          } catch (err) {
            console.error("CSV import failed:", err);
            alert("CSV import failed. Check console.");
          }
        },
        error: (err) => {
          console.error("CSV parse error:", err);
          alert("Could not parse CSV. Check console.");
        },
      });
    });
  }

  const remindersToday = useMemo(() => {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  const tomorrowYmd = toYmdLocal(tomorrow);

  return (recruits || [])
    .filter((r) => {
      if (!r.actionItemDueAt) return false;

      const dueYmd = toYmdLocal(r.actionItemDueAt);
      if (!dueYmd || dueYmd !== tomorrowYmd) return false;

      // If reminder already sent for this exact due date, don't show it
      if (
        r.lastAdminReminderSentForDueDate &&
        r.lastAdminReminderSentForDueDate === dueYmd
      ) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      // Level 4 first, then 3, then 2, then 1
      const aPriority = Number(a.levelOfUrgency || 1);
      const bPriority = Number(b.levelOfUrgency || 1);

      if (aPriority !== bPriority) return bPriority - aPriority;

      const aName = a.fullName || a.email || "";
      const bName = b.fullName || b.email || "";
      return aName.localeCompare(bName);
    });
}, [recruits]);

const dashboardStats = useMemo(() => {
  const rows = recruits || [];

  const total = rows.length;

  const recruited = rows.filter(
    (r) => normalizeRecruitStatus(r.status) === "Recruited"
  ).length;

  const meetingScheduled = rows.filter(
    (r) => normalizeRecruitStatus(r.status) === "Meeting scheduled"
  ).length;

  const meetingHeld = rows.filter(
    (r) => normalizeRecruitStatus(r.status) === "Meeting held"
  ).length;

  const statusCounts = rows.reduce((acc, r) => {
    const normalized = normalizeRecruitStatus(r.status);

    if (!normalized || !STATUS_OPTIONS.includes(normalized)) return acc;

    acc[normalized] = (acc[normalized] || 0) + 1;
    return acc;
  }, {});

  const phaseCounts = rows.reduce((acc, r) => {
    const phase = levelToPhase(r.level) || "—";
    acc[phase] = (acc[phase] || 0) + 1;
    return acc;
  }, {});

  const priorityCounts = rows.reduce((acc, r) => {
  const level = Number(r.levelOfUrgency || 1);

  if (![1, 2, 3, 4].includes(level)) return acc;

  acc[level] = (acc[level] || 0) + 1;
  return acc;
}, {});

  return {
    total,
    recruited,
    meetingScheduled,
    meetingHeld,
    statusCounts,
    phaseCounts,
    priorityCounts,
  };
}, [recruits]);

  return (
    <div className="min-h-screen bg-[var(--color-wrcGray)] flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl ${stripeYellow} border border-black/10`} />
            <div>
              <div className="text-xs text-gray-500">Weichert Realtors Cornerstone</div>
              <div className={`text-lg font-extrabold ${headerBlack}`}>WRC Recruits — Admin</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className={`text-sm font-semibold ${headerBlack}`}>
                {profile?.fullName || user?.displayName || "Admin"}
              </div>
              <div className="text-xs text-gray-500">
                {officeLabel} • {user?.email}
              </div>
            </div>

    <div className="flex items-center gap-2">
  <button
    onClick={() => setAddRecruitOpen(true)}
    className="px-4 py-2 rounded-md bg-black text-[var(--color-wrcYellowUI)] text-sm font-extrabold hover:opacity-90"
  >
    + Add Recruit
  </button>

  <button
    onClick={() => navigate("/admin/users")}
    className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-semibold hover:bg-gray-50"
  >
    User Roster
  </button>

  <button
    onClick={handleLogout}
    className="px-4 py-2 rounded-md bg-black text-white font-semibold hover:opacity-90"
  >
    Logout
  </button>
</div>

            </div>
        </div>
        <div className={`h-2 ${stripeYellow}`} />
      </header>

      <main className="w-full max-w-[1400px] mx-auto px-6 py-6 flex flex-col gap-6 flex-1 min-h-0">

        <section className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
  <div className="flex items-center justify-between gap-3">
    <div>
      <h3 className={`text-lg font-bold ${headerBlack}`}>Recruit Snapshot</h3>
      <div className="text-sm text-gray-500">
        Click any card or status to open a recruit list.
      </div>
    </div>
  </div>

<div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
  <button
    type="button"
    onClick={() => openSnapshotModal("recruited")}
    className="rounded-xl border border-gray-200 p-4 text-left hover:bg-gray-50"
  >
    <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
      Recruited
    </div>
    <div className="mt-1 text-3xl font-extrabold text-[var(--color-wrcBlack)]">
      {dashboardStats.recruited}
    </div>
  </button>

  <button
    type="button"
    onClick={() => openSnapshotModal("phase", "Engagement Phase")}
    className="rounded-xl border border-gray-200 p-4 text-left hover:bg-gray-50"
  >
    <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
      Engagement Phase
    </div>
    <div className="mt-1 text-3xl font-extrabold text-gray-700">
      {dashboardStats.phaseCounts["Engagement Phase"] || 0}
    </div>
  </button>

<button
  type="button"
  onClick={() => openSnapshotModal("phase", "Relationship Building Phase")}
  className="rounded-xl border border-gray-200 p-4 text-left hover:bg-gray-50"
>
  <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
    Relationship Building
  </div>
  <div className="mt-1 text-3xl font-extrabold text-blue-700">
    {dashboardStats.phaseCounts["Relationship Building Phase"] || 0}
  </div>
</button>

  <button
    type="button"
    onClick={() => openSnapshotModal("phase", "Sphere of Influence")}
    className="rounded-xl border border-gray-200 p-4 text-left hover:bg-gray-50"
  >
    <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
      Sphere of Influence
    </div>
    <div className="mt-1 text-3xl font-extrabold text-red-700">
      {dashboardStats.phaseCounts["Sphere of Influence"] || 0}
    </div>
  </button>

  <button
    type="button"
    onClick={() => openSnapshotModal("meetingScheduled")}
    className="rounded-xl border border-gray-200 p-4 text-left hover:bg-gray-50"
  >
    <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
      Meeting scheduled
    </div>
    <div className="mt-1 text-3xl font-extrabold text-[var(--color-wrcBlack)]">
      {dashboardStats.meetingScheduled}
    </div>
  </button>

  <button
    type="button"
    onClick={() => openSnapshotModal("meetingHeld")}
    className="rounded-xl border border-gray-200 p-4 text-left hover:bg-gray-50"
  >
    <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
      Meeting held
    </div>
    <div className="mt-1 text-3xl font-extrabold text-[var(--color-wrcBlack)]">
      {dashboardStats.meetingHeld}
    </div>
  </button>

  <div className="rounded-xl border border-gray-200 p-4">
    <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
      Total recruits
    </div>
    <div className="mt-1 text-3xl font-extrabold text-[var(--color-wrcBlack)]">
      {dashboardStats.total}
    </div>
    <div className="mt-1 text-xs text-gray-500">
      Total records in the system
    </div>
  </div>
</div>

  <div className="mt-6">
    <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
      Status breakdown
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      {Object.entries(dashboardStats.statusCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => (
          <button
            key={status}
            type="button"
            onClick={() => openSnapshotModal("status", status)}
            className="px-3 py-2 rounded-full border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-800 hover:bg-gray-100"
          >
            {status}: <span className="font-extrabold">{count}</span>
          </button>
        ))}
    </div>
  </div>
  <div className="mt-6">
  <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
    Phase breakdown
  </div>

  <div className="mt-3 flex flex-wrap gap-2">
    {Object.entries(dashboardStats.phaseCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([phase, count]) => (
        <button
          key={phase}
          type="button"
          onClick={() => openSnapshotModal("phase", phase)}
          className="px-3 py-2 rounded-full border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-800 hover:bg-gray-100"
        >
          {phase}: <span className="font-extrabold">{count}</span>
        </button>
      ))}
  </div>
</div>
</section>
<div className="grid gap-6 lg:grid-cols-3">
  <section className="lg:col-span-2 bg-white rounded-2xl shadow-lg p-6 border-t-4 border-[var(--color-wrcYellowUI)]">
    <h3 className={`text-lg font-bold ${headerBlack}`}>Import Recruits (CSV)</h3>
    <p className="mt-1 text-sm text-gray-600">
      Upload a Courted export (tab-delimited) or standard CSV. Email is used as the deterministic recruit ID.
    </p>

    <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
      <input
        id="csv-upload"
        type="file"
        accept=".csv,.tsv,text/csv,text/tab-separated-values"
        className="hidden"
        onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
      />

      <label
        htmlFor="csv-upload"
        className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md cursor-pointer
                   bg-[var(--color-wrcYellowUI)] text-[var(--color-wrcBlack)]
                   font-extrabold border border-black/20 hover:brightness-95 w-full md:w-auto"
      >
        📂 Choose File
      </label>

      <div className="flex-1">
        <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-700 truncate">
          {csvFile ? csvFile.name : "No file selected"}
        </div>
      </div>

      <button
        disabled={!csvFile}
        onClick={() => handleImportCsv(csvFile)}
        className="px-4 py-2 rounded-md bg-black text-[var(--color-wrcYellowUI)]
                   font-extrabold disabled:opacity-50 disabled:cursor-not-allowed w-full md:w-auto"
      >
        Upload
      </button>
    </div>

    <div className="mt-3 text-xs text-gray-500">
      Expected Courted columns: First Name, Last Name, Email, Phone, Current Office, Assigned To, Last Interaction Date,
      Status, Years in Industry, LTM Sales Volume, LTM Sales Volume % Growth, Potential to Move, Years in Office,
      Note 1, Note 2, Note 3.
    </div>
  </section>

  <section className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
    <div>
      <h3 className={`text-lg font-bold ${headerBlack}`}>Scheduling Priority Snapshot</h3>
      <p className="mt-1 text-sm text-gray-600">
        Current recruit counts by Scheduling Priority Level.
      </p>
    </div>

    <div className="mt-4 space-y-3">
<button
  type="button"
  onClick={() => openSnapshotModal("priority", 4)}
  className="w-full rounded-xl border border-red-200 bg-red-50 p-4 text-left hover:bg-red-100"
>
  <div className="text-xs font-bold tracking-wide text-red-700 uppercase">
    Level 4
  </div>
  <div className="mt-1 text-3xl font-extrabold text-red-700">
    {dashboardStats.priorityCounts[4] || 0}
  </div>
  <div className="mt-1 text-xs text-red-700">
    Must be contacted that day
  </div>
</button>

<button
  type="button"
  onClick={() => openSnapshotModal("priority", 3)}
  className="w-full rounded-xl border border-orange-200 bg-orange-50 p-4 text-left hover:bg-orange-100"
>
  <div className="text-xs font-bold tracking-wide text-orange-700 uppercase">
    Level 3
  </div>
  <div className="mt-1 text-3xl font-extrabold text-orange-700">
    {dashboardStats.priorityCounts[3] || 0}
  </div>
  <div className="mt-1 text-xs text-orange-700">
    -1 day to +1 day
  </div>
</button>

<button
  type="button"
  onClick={() => openSnapshotModal("priority", 2)}
  className="w-full rounded-xl border border-blue-200 bg-blue-50 p-4 text-left hover:bg-blue-100"
>
  <div className="text-xs font-bold tracking-wide text-blue-700 uppercase">
    Level 2
  </div>
  <div className="mt-1 text-3xl font-extrabold text-blue-700">
    {dashboardStats.priorityCounts[2] || 0}
  </div>
  <div className="mt-1 text-xs text-blue-700">
    -1 day to +2 days
  </div>
</button>

<button
  type="button"
  onClick={() => openSnapshotModal("priority", 1)}
  className="w-full rounded-xl border border-gray-200 bg-gray-50 p-4 text-left hover:bg-gray-100"
>
  <div className="text-xs font-bold tracking-wide text-gray-700 uppercase">
    Level 1
  </div>
  <div className="mt-1 text-3xl font-extrabold text-gray-700">
    {dashboardStats.priorityCounts[1] || 0}
  </div>
  <div className="mt-1 text-xs text-gray-700">
    -1 day to +3 days
  </div>
</button>
    </div>
  </section>
</div>
{/* <section className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
  <div>
    <h3 className={`text-lg font-bold ${headerBlack}`}>Recruits</h3>
    <p className="text-sm text-gray-600">Manage recruits and journals.</p>
  </div>
</section> */}


<section className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
  <div className="flex items-center justify-between gap-3">
    <div>
      <h3 className={`text-lg font-bold ${headerBlack}`}>
        Recruits that need reminders today
      </h3>
      <p className="text-sm text-gray-600">
        These recruits have an Action Item Due Date of tomorrow and do not yet have a reminder logged for that due date.
      </p>
    </div>

    <div className="text-sm font-extrabold text-[var(--color-wrcBlack)]">
      {remindersToday.length}
    </div>
  </div>

  <div className="mt-4">
    {remindersToday.length === 0 ? (
      <div className="text-sm text-gray-500">
        No reminder emails need to be sent today.
      </div>
    ) : (
      <div className="space-y-3">
        {remindersToday.map((r) => (
          <div
            key={r.id}
            onClick={() =>
              navigate(`/admin/recruit/${r.id}`, {
                state: {
                  backgroundLocation: location,
                  dashboardState: {
                    selectedRecruitIds,
                    filteredRecruitIds,
                    scrollY: window.scrollY,
                  },
                },
              })
            }
            className="rounded-xl border border-gray-200 p-4 hover:bg-gray-50 cursor-pointer"
          >
            <div className="flex items-start justify-between gap-3">
             <div>
  <div className="text-sm font-extrabold text-[var(--color-wrcBlack)]">
    {r.fullName || r.email || r.id}
  </div>

  <div className="mt-2 flex flex-wrap items-center gap-2">
    <SmallBadge
      tone={adminTouchTone(
        r.lastAdminTouchedByName,
        profile?.fullName || user?.displayName || user?.email
      )}
    >
      Last touched: {r.lastAdminTouchedByName || "—"}
    </SmallBadge>
{r.lastAdminReminderSentByName ? (
  <div className="mt-2 flex flex-wrap items-center gap-2">
    <SmallBadge tone="green">
      Reminder sent: {r.lastAdminReminderSentByName}
    </SmallBadge>
    <span className="text-xs text-gray-500">
      {fmtTs(r.lastAdminReminderSentAt)}
    </span>
  </div>
) : null}
    {r.lastAdminTouchedAt ? (
      <span className="text-xs text-gray-500">{fmtTs(r.lastAdminTouchedAt)}</span>
    ) : null}
  </div>

  <div className="mt-2 text-xs text-gray-500">
    Due: {fmtTs(r.actionItemDueAt) || "—"}
  </div>

  <div className="mt-1 text-xs text-gray-500">
    Assigned agent: {r.assignedAgentName || r.assignedAgentEmail || "—"}
  </div>
</div>

              <div className="text-right">
                <div className="inline-flex px-3 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-extrabold">
                  {urgencyLevelPillLabel(r.levelOfUrgency)}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {levelToPhase(r.level) || "—"}
                </div>
              </div>
            </div>

            {r.actionItemText ? (
              <div className="mt-3 text-sm text-gray-700">
                <span className="font-semibold">Action Item:</span> {r.actionItemText}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    )}
  </div>
</section>

        <section className="bg-white rounded-2xl shadow-lg p-6 border border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className={`text-lg font-bold ${headerBlack}`}>Alerts</h3>
              <p className="text-sm text-gray-600">
                Unread:{" "}
                <span className="font-extrabold text-[var(--color-wrcBlack)]">
                  {unreadCount}
                </span>
              </p>
            </div>

            <button
              onClick={async () => {
                try {
                  const batch = writeBatch(db);
                  let ops = 0;

                  for (const a of alerts) {
                    if (a.unreadByAdmins !== true) continue;
               batch.update(doc(db, ...a.refPath.split("/")), {
                unreadByAdmins: false,
                 readAt: serverTimestamp(),
                readByUid: user?.uid || null,
            });

                    ops++;
                    if (ops >= 450) break;
                  }

                  if (ops > 0) await batch.commit();
                } catch (e) {
                  console.error("mark alerts read failed:", e);
                  alert("Could not mark alerts read. Check console.");
                }
              }}
              disabled={unreadCount === 0}
              className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
            >
              Mark all read
            </button>
            <button
  onClick={async () => {
    try {
      // Pull a batch of recent alerts regardless of unread flag
      const qAll = query(
        collectionGroup(db, "activity"),
        orderBy("createdAt", "desc"),
        limit(200)
      );

      const snap = await getDocs(qAll);

      const batch = writeBatch(db);
      let ops = 0;

      snap.forEach((d) => {
        batch.update(d.ref, {
          unreadByAdmins: true,
          reopenedAt: serverTimestamp(),
          reopenedByUid: user?.uid || null,
        });
        ops++;
      });

      if (ops) await batch.commit();
      alert(`Reopened ${ops} alert(s).`);
    } catch (e) {
      console.error("reopen alerts failed:", e);
      alert(e.message || "Could not reopen alerts.");
    }
  }}
  className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-semibold hover:bg-gray-50"
>
  Reopen last 200
</button>

          </div>

<div className="mt-4">
  <div className="max-h-[520px] overflow-y-auto pr-1 space-y-3">
    {alerts.length === 0 ? (
      <div className="text-sm text-gray-500">No alerts yet.</div>
    ) : (
alerts.map((a) => {
  const rid = a.recruitId || (a.refPath ? a.refPath.split("/")[1] : null);

  const displayName =
    (a.recruitName || "").trim() ||
    (rid ? recruitNameById.get(rid) : null) ||
    "Recruit";

  return (
    <div
      key={`${a.refPath || a.id}`} // avoid duplicate keys
      onClick={() => {
       if (rid) {
  navigate(`/admin/recruit/${rid}`, {
    state: {
      backgroundLocation: location,
  dashboardState: {
  selectedRecruitIds,
  filteredRecruitIds,
  scrollY: window.scrollY,
},
    },
  });
}
      }}
      className={`rounded-xl border p-3 hover:bg-gray-50 cursor-pointer transition ${
        a.unreadByAdmins ? "border-[var(--color-wrcYellowUI)]" : "border-gray-200"
      }`}
      title="Open recruit"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-[var(--color-wrcBlack)]">
          <span className="font-extrabold">{displayName}</span>
          <span className="text-gray-500"> — </span>
          {getAlertMessage(a)}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500">{fmtTs(a.createdAt)}</span>

          {a.unreadByAdmins ? (
            <span className="text-xs font-extrabold px-2 py-1 rounded-full bg-[var(--color-wrcYellowUI)] text-black">
              NEW
            </span>
          ) : null}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleClearAlert(a);
            }}
            className="px-3 py-1 rounded-md border border-gray-300 bg-white text-xs font-bold hover:bg-gray-50"
            title="Remove this alert"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mt-1 text-xs text-gray-500">
        {a.actorName ? `${a.actorName} • ` : ""}
        {a.type || a.eventType || "event"}
        {a.field
          ? ` • ${a.field}`
          : Array.isArray(a.changes) && a.changes[0]?.field
          ? ` • ${a.changes[0].field}`
          : ""}
      </div>
    </div>
  );
})

    )}
  </div>
</div>

        </section>

 <RecruitGrid
          recruits={recruits}
          mode="admin"
          filteredIds={filteredRecruitIds}
          onOpenRecruit={(r) =>
            navigate(`/admin/recruit/${r.id}`, {
              state: {
                backgroundLocation: location,
                dashboardState: {
                  selectedRecruitIds,
                  filteredRecruitIds,
                  scrollY: window.scrollY,
                },
              },
            })
          }
          selectedIds={selectedRecruitIds}
          onSelectedIdsChange={setSelectedRecruitIds}
          onFilteredIdsChange={setFilteredRecruitIds}
          currentUser={user}
          currentProfile={profile}
        />



      </main>

{snapshotModal.open && (
  <div className="fixed inset-0 z-50">
    {/* backdrop */}
    <div
      className="absolute inset-0 bg-black/40"
  onClick={closeSnapshotDrawer}
    />

    {/* slide-in drawer */}
    <div
  className={`absolute inset-y-0 right-0 w-full max-w-4xl bg-white shadow-2xl border-l border-gray-200 flex flex-col ${
    snapshotClosing
      ? "animate-[slideOutRight_.25s_ease-in]"
      : "animate-[slideInRight_.25s_ease-out]"
  }`}
>
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div>
          <h3 className="text-xl font-extrabold text-[var(--color-wrcBlack)]">
            {snapshotModal.title}
          </h3>
          <p className="text-sm text-gray-500">
            {snapshotModal.rows.length} recruit{snapshotModal.rows.length === 1 ? "" : "s"}
          </p>
        </div>

        <button
          type="button"
          onClick={closeSnapshotDrawer}
          className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-semibold hover:bg-gray-50"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {snapshotModal.rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No recruits found.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-gray-100 z-10">
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Recruit</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Status</th>
               <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Priority</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Phase</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Assigned Agent</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">Last Activity</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">
  Last admin touched
</th>
<th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">
  Last reminder sent
</th>
              </tr>
            </thead>

            <tbody>
              {snapshotModal.rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-gray-100 hover:bg-yellow-50 cursor-pointer"
                  onClick={() => {
                    navigate(`/admin/recruit/${r.id}`, {
                      state: {
                        backgroundLocation: location,
                        dashboardState: {
                          selectedRecruitIds,
                          filteredRecruitIds,
                          scrollY: window.scrollY,
                          snapshotModal, // ✅ preserve open drawer state
                        },
                      },
                    });
                  }}
                >
                  <td className="px-4 py-3 align-top">
                    <div className="text-sm font-semibold text-gray-900">
                      {r.fullName || r.email || r.id}
                    </div>
                    <div className="text-xs text-gray-500">{r.email || "—"}</div>
                  </td>

                  <td className="px-4 py-3 align-top text-sm text-gray-800">
                    {normalizeRecruitStatus(r.status) || "—"}
                  </td>

                  <td className="px-4 py-3 align-top text-sm text-gray-800">
                    {r.levelOfUrgency ? urgencyLevelPillLabel(r.levelOfUrgency) : "—"}
                  </td>

                  <td className="px-4 py-3 align-top text-sm text-gray-800">
                    {fmtLevel(r.level)}
                  </td>

                  <td className="px-4 py-3 align-top text-sm text-gray-800">
                    {r.assignedAgentName || r.assignedAgentEmail || "—"}
                  </td>

                  <td className="px-4 py-3 align-top text-sm text-gray-800">
                    {fmtTs(r.lastActivityAt) || "—"}
                  </td>
                  <td className="px-4 py-3 align-top text-sm text-gray-800">
  <div>{r.lastAdminTouchedByName || "—"}</div>
  <div className="text-xs text-gray-500">
    {fmtTs(r.lastAdminTouchedAt) || ""}
  </div>
</td>

<td className="px-4 py-3 align-top text-sm text-gray-800">
  <div>{r.lastAdminReminderSentByName || "—"}</div>
  <div className="text-xs text-gray-500">
    {fmtTs(r.lastAdminReminderSentAt) || ""}
  </div>
</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  </div>
)}
{addRecruitOpen && (
  <div className="fixed inset-0 z-50">
    {/* backdrop */}
    <div
      className="absolute inset-0 bg-black/40"
      onClick={() => setAddRecruitOpen(false)}
    />

    {/* panel */}
    <div className="absolute inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl border-l border-gray-200 flex flex-col animate-[slideInRight_.25s_ease-out]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div>
          <h3 className="text-xl font-extrabold text-[var(--color-wrcBlack)]">
            Add Recruit
          </h3>
          <p className="text-sm text-gray-500">
            Quick create a new recruit
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAddRecruitOpen(false)}
          className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-semibold hover:bg-gray-50"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <AdminAddRecruitForm
          onCreated={(id) => {
            setAddRecruitOpen(false);
            navigate(`/admin/recruit/${id}`);
          }}
        />
      </div>
    </div>
  </div>
)}
    </div>
  );
}
