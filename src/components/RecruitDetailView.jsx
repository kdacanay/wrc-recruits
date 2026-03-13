// RecruitDetailView.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import {
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  where,
  orderBy,
  limit
} from "firebase/firestore";
import RecruitJournal from "./RecruitJournal";
import RecruitActivityFeed from "./RecruitActivityFeed";
import { STATUS_OPTIONS, SOURCE_OPTIONS, URGENCY_OPTIONS } from "../constants/recruitOptions";
import { logRecruitActivity } from "../utils/logRecruitActivity";
import { useAuth } from "../contexts/AuthContext";
import { logRecruitEvent } from "../utils/logRecruitEvent";
import { LEVEL_DROPDOWN_OPTIONS, levelToPhase, normalizeLevel, PHASE_HELP } from "../utils/phaseLevel";
import {
  URGENCY_LEVEL_OPTIONS,
  normalizeUrgencyLevel,
  urgencyLevelPillLabel,
  urgencyLevelDropdownLabel,
  urgencyLevelTone,
  SCHEDULING_PRIORITY_HELP
} from "../utils/urgencyLevel";
import EmailAssignedAgentModal from "./EmailAssignedAgentModal";
import {
  buildAssignedAgentEmail,
  copyToClipboard,
  openMailDraft,
} from "../utils/notifyAssignedAgent";

const QUICK_LOG_TYPES = [
  { type: "call", label: "Calls", icon: "📞" },
  { type: "text", label: "Texts", icon: "💬" },
  { type: "email", label: "Emails", icon: "📧" },
  { type: "appointment_set", label: "Appts Set", icon: "📅" },
  { type: "interview", label: "Interviews", icon: "🤝" },
  { type: "signed", label: "Signed/Hired", icon: "🎉" },
];

function PhaseDropdown({ value, onChange, disabled = false }) {
  const [showHelp, setShowHelp] = React.useState(false);

  const normalizedValue = normalizeLevel(value);

  return (
    <div className="space-y-1">
      {/* <label className="text-sm font-medium">Phase</label> */}

      <select
  className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
  value={normalizedValue}
  disabled={disabled}
  onChange={(e) => {
  const v = e.target.value;
  onChange(v === "" ? "" : Number(v));
}}
>
        {LEVEL_DROPDOWN_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="text-xs underline text-gray-600"
        onClick={() => setShowHelp((s) => !s)}
      >
        What’s this?
      </button>

      {showHelp && <PhaseHelpPanel />}

      <div className="text-[11px] text-gray-500">
        Current phase: {levelToPhase(normalizedValue)}
      </div>
    </div>
  );
}

function UrgencyLevelDropdown({ value, onChange, disabled = false }) {
  const [showHelp, setShowHelp] = React.useState(false);
  const normalizedValue = normalizeUrgencyLevel(value);

  return (
    <div className="space-y-1">
      <select
        className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
        value={normalizedValue}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {URGENCY_LEVEL_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.dropdownLabel}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="text-xs underline text-gray-600"
        onClick={() => setShowHelp((s) => !s)}
      >
        What’s this?
      </button>

{showHelp && <SchedulingPriorityHelpPanel />}

      <div className="text-[11px] text-gray-500">
        Current priority: {urgencyLevelDropdownLabel(normalizedValue)}
      </div>
    </div>
  );
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

const RELATIONSHIP_OPTIONS = ["0% untouched", "18% 1st touch", "34% 2nd touch", "56% 3rd touch", "78% 4th touch"];


const LEVEL_OPTIONS = [
  { value: "DNC", label: "DNC", desc: "Permanent removal from the list (do not contact)." },
  { value: "0", label: "Level 0", desc: "Reached and confirmed no interest in moving now or in the near future." },
  { value: "1", label: "Level 1", desc: "Open to ongoing conversation, but not ready to schedule a meeting." },
  { value: "2", label: "Level 2", desc: "Open to meet and discuss Weichert in more detail." },
  { value: "3", label: "Level 3", desc: "Converted: hired or expected to hire." },
];



function toNumberOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toPercentNumberOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const cleaned = s.endsWith("%") ? s.slice(0, -1) : s;
  const n = Number(cleaned.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function tsToText(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

function toInputDate(ts) {
  if (!ts) return "";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return "";
  }
}

function inputDateToDateOrNull(dateStr) {
  if (!dateStr) return null;
  return new Date(`${dateStr}T12:00:00`);
}

function fmtDateShort(tsOrDate) {
  if (!tsOrDate) return "—";
  try {
    const d = tsOrDate.toDate ? tsOrDate.toDate() : new Date(tsOrDate);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toLocaleDateString();
  } catch {
    return "—";
  }
}

function followUpCallout(nextFollowUpAt) {
  const d = nextFollowUpAt?.toDate
    ? nextFollowUpAt.toDate()
    : nextFollowUpAt
    ? new Date(nextFollowUpAt)
    : null;

  if (!d || Number.isNaN(d.getTime())) {
    return { tone: "gray", title: "Next follow-up not set", subtitle: "Ask your admin to set a follow-up date." };
  }

  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((d0.getTime() - t0.getTime()) / 86400000);
  const dateText = d0.toLocaleDateString();

  if (diffDays < 0) return { tone: "red", title: `Overdue follow-up: ${dateText}`, subtitle: `Overdue by ${Math.abs(diffDays)} day(s)` };
  if (diffDays === 0) return { tone: "orange", title: `Follow-up due today: ${dateText}`, subtitle: "Make contact today if possible" };
  if (diffDays <= 3) return { tone: "orange", title: `Follow-up due soon: ${dateText}`, subtitle: `Due in ${diffDays} day(s)` };
  return { tone: "green", title: `Next follow-up: ${dateText}`, subtitle: `Due in ${diffDays} day(s)` };
}

function momentumStatus({ nextFollowUpAt, lastActivityAt }) {
  const now = new Date();

  const nf = nextFollowUpAt?.toDate ? nextFollowUpAt.toDate() : nextFollowUpAt ? new Date(nextFollowUpAt) : null;
  const la = lastActivityAt?.toDate ? lastActivityAt.toDate() : lastActivityAt ? new Date(lastActivityAt) : null;

  const msDay = 86400000;
  const daysSinceActivity = la ? Math.floor((now.getTime() - la.getTime()) / msDay) : null;

  const hasFollowUp = !!(nf && !Number.isNaN(nf.getTime()));
  const followUpOverdue = hasFollowUp && nf < now;

  const stale14 = !la || (daysSinceActivity !== null && daysSinceActivity >= 14);

  // Logic B: needs attention if follow-up missing/overdue OR stale 14+ days
 // ✅ Your requested rule:
// Needs attention ONLY if overdue follow-up (when present) OR stale 14+ days.
// Missing follow-up does NOT count.
const needsAttention = followUpOverdue || stale14;

  // Friendly labels
  let tone = "green";
  let title = "On track";
  let subtitle = "Momentum looks good.";

if (stale14) {
  tone = "red";
  title = "Stale (14+ days)";
  subtitle = la
    ? `No activity for ${daysSinceActivity} day(s).`
    : "No activity recorded yet.";
}
else if (followUpOverdue) {
  tone = "red";
  title = "Follow-up overdue";
  subtitle = `Was due ${nf.toLocaleDateString()}.`;
}
else {
  // ✅ Everything else is ON TRACK — even if no follow-up exists
  tone = "green";

  if (hasFollowUp) {
    const daysUntil = Math.ceil((nf.getTime() - now.getTime()) / msDay);
    title = "Next follow-up scheduled";
    subtitle = `Due in ${daysUntil} day(s) (${nf.toLocaleDateString()}).`;
  } else {
    title = "Touched recently";
    subtitle = "No follow-up date set yet.";
  }
}


  return { needsAttention, tone, title, subtitle, nf, la, daysSinceActivity };
}

function SchedulingPriorityHelpPanel() {
  const [openKey, setOpenKey] = React.useState("priority-overview");

  return (
    <div className="text-xs text-gray-700 border rounded p-2 bg-white space-y-2">
      {SCHEDULING_PRIORITY_HELP.map((sec) => (
        <div key={sec.key} className="border rounded">
          <button
            type="button"
            className="w-full text-left px-2 py-2 font-semibold"
            onClick={() => setOpenKey(openKey === sec.key ? null : sec.key)}
          >
            {sec.title}
          </button>

          {openKey === sec.key && (
            <div className="px-2 pb-2 space-y-1">
              {sec.bullets.map(([label, text]) => (
                <div key={label}>
                  <strong>{label}:</strong> {text}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
function PhaseHelpPanel() {
  const [openKey, setOpenKey] = React.useState("engagement");

  return (
    <div className="text-xs text-gray-700 border rounded p-2 bg-white space-y-2">
      {PHASE_HELP.map((sec) => (
        <div key={sec.key} className="border rounded">
          <button
            type="button"
            className="w-full text-left px-2 py-2 font-semibold"
            onClick={() => setOpenKey(openKey === sec.key ? null : sec.key)}
          >
            {sec.title}
          </button>

          {openKey === sec.key && (
            <div className="px-2 pb-2 space-y-1">
              {sec.bullets.map(([label, text]) => (
                <div key={label}>
                  <strong>{label}:</strong> {text}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Pill({ children, tone = "gray" }) {
  const base = "inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border";
  const tones = {
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    gray: "bg-gray-50 border-gray-200 text-gray-700",
    red: "bg-red-50 border-red-200 text-red-800",
    orange: "bg-orange-50 border-orange-200 text-orange-800",
    green: "bg-green-50 border-green-200 text-green-800",
  };
  return <span className={`${base} ${tones[tone] || tones.gray}`}>{children}</span>;
}

function urgencyTone(u) {
  const v = String(u || "").toLowerCase();
  if (v.includes("very likely") || v === "likely") return "red";
  if (v === "not sure") return "gray";
  if (v.includes("very low") || v.includes("low")) return "green";
  return "gray";
}

function addDaysToDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  // noon avoids timezone edge cases
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

function fmtFollowUpLabel(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString();
  } catch {
    return "—";
  }
}
function formatPhone(phone) {
  if (!phone) return "—";

  const digits = String(phone).replace(/\D/g, "");

  // US 10-digit
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // US 11-digit with leading country code 1
  if (digits.length === 11 && digits.startsWith("1")) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  // fallback: show original
  return String(phone);
}

function telHref(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `tel:${digits}` : null;
}
// profile formatting helpers
function getRecruitDisplayName(r) {
  return (
    r?.fullName ||
    `${r?.firstName || ""} ${r?.lastName || ""}`.trim() ||
    r?.email ||
    r?.id ||
    "Recruit"
  );
}


function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(v) {
  const n = numOrNull(v);
  if (n === null) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(v) {
  const n = numOrNull(v);
  if (n === null) return "—";
  return `${n}%`;
}

function growthTone(v) {
  const n = numOrNull(v);
  if (n === null) return "gray";
  return n >= 0 ? "green" : "red";
}

function potentialTone(v) {
  const s = String(v || "").toLowerCase();
  if (s === "high" || s === "very likely" || s === "likely") return "red";
  if (s === "low" || s.includes("very low")) return "green";
  return "gray";
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900 text-right break-words">{value ?? "—"}</div>
    </div>
  );
}

function diffChanges(before, after) {
  const changes = [];
  for (const [field, to] of Object.entries(after)) {
    const from = before[field];
    const same = JSON.stringify(from ?? null) === JSON.stringify(to ?? null);
    if (!same) changes.push({ field, from: from ?? null, to: to ?? null });
  }
  return changes;
}


export default function RecruitDetailView({ recruitId, mode = "agent", agents = [], onBack }) {

  const [emailModalOpen, setEmailModalOpen] = useState(false);
const [emailPayload, setEmailPayload] = useState(null);
const [toast, setToast] = useState(null); // optional quick toast

function maybePromptEmailAssignedAgent({
  assignedAgentEmail,
  assignedAgentName,
  recruitName,
  recruitId,
  recruitPhone,
  recruitEmail,
  urgencyLevel,
   actionItemText,
  actionItemDueText,
}) {
  if (!assignedAgentEmail) return;

  const { subject, body, to } = buildAssignedAgentEmail({
    agentEmail: assignedAgentEmail,
    recruitName: recruitName || "—",
    recruitId,
    recruitPhone: recruitPhone || "—",
    recruitEmail: recruitEmail || "—",
    urgencyLevel,
    actionItemText: actionItemText || null,
    actionItemDueText: actionItemDueText || null,
    appUrl: "https://wrc-recruits.web.app",
  });

  setEmailPayload({ to, subject, body });
  setEmailModalOpen(true);
}

  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("email") === "1") {
      setEmailModalOpen(true);

      // optional: remove param so refresh doesn't keep re-opening
      params.delete("email");
      const qs = params.toString();
      navigate(qs ? `${location.pathname}?${qs}` : location.pathname, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);
  const { user, profile } = useAuth();

async function handleCopyAndOpenDraft() {
  try {
    if (!emailPayload?.to || !recruit?.id) return;

    const adminName =
      profile?.fullName || user?.displayName || user?.email || "Admin";

    const dueDateText =
      adminForm.actionItemDueDate ||
      toInputDate(recruit?.actionItemDueAt) ||
      null;

    const copyText = `Subject: ${emailPayload.subject}\n\n${emailPayload.body}`;
    await copyToClipboard(copyText);

    openMailDraft(emailPayload);

    await updateDoc(doc(db, "recruits", recruit.id), {
      lastAdminReminderSentAt: serverTimestamp(),
      lastAdminReminderSentByUid: user?.uid || null,
      lastAdminReminderSentByName: adminName,
      lastAdminReminderSentForDueDate: dueDateText,

      lastAdminTouchedAt: serverTimestamp(),
      lastAdminTouchedByUid: user?.uid || null,
      lastAdminTouchedByName: adminName,

      lastActivityText: dueDateText
        ? `Admin sent reminder email to assigned agent for due date ${dueDateText}`
        : "Admin sent reminder email to assigned agent",
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      lastUpdatedByUid: user?.uid || null,
      lastUpdatedByName: adminName,
      lastUpdatedByRole: "admin",
      lastUpdatedAt: serverTimestamp(),
    });

    await addDoc(collection(db, "recruits", recruit.id, "events"), {
      type: "admin_reminder_email",
      text: dueDateText
        ? `Admin sent reminder email to assigned agent for due date ${dueDateText}`
        : "Admin sent reminder email to assigned agent",
      visibility: "admin",
      createdAt: serverTimestamp(),
      authorUid: user?.uid || null,
      authorName: adminName,
      authorEmail: user?.email || null,
      authorRole: "admin",
    });

    await logRecruitActivity(recruit.id, {
      type: "admin_reminder_email",
      message: dueDateText
        ? `Admin sent reminder email to assigned agent for due date ${dueDateText}`
        : "Admin sent reminder email to assigned agent",
      recruitId: recruit.id,
      recruitName: getRecruitDisplayName(recruit),
      actorUid: user?.uid || null,
      actorName: adminName,
      actorEmail: user?.email || null,
      actorRole: "admin",
      changes: [
        {
          field: "lastAdminReminderSentForDueDate",
          from: recruit?.lastAdminReminderSentForDueDate || null,
          to: dueDateText,
        },
      ],
      unreadByAdmins: false,
    });

    setEmailModalOpen(false);
    setToast("Copied to clipboard and opened a draft.");
    setTimeout(() => setToast(null), 2500);
  } catch (e) {
    console.error(e);
    setToast("Could not copy to clipboard. Your browser may have blocked it.");
    setTimeout(() => setToast(null), 3000);
  }
}
  // ✅ make admin resilient (even if parent forgets to pass mode="admin")
  const isAdmin = profile?.role === "admin" || mode === "admin";
async function updateLevel(recruitId, nextLevel) {
  const ref = doc(db, "recruits", recruitId);
  await updateDoc(ref, {
    level: nextLevel,
    updatedAt: serverTimestamp(),
  });
}
//   async function quickLog(type, label) {
//   if (!isAdmin) {
//     alert("Quick Log is admin-only.");
//     return;
//   }
//   if (!recruit?.id) return;

//   try {
//     await logRecruitEvent(recruit.id, {
//       type,
//       text: "",
//       visibility: "shared", // ✅ keep shared so agent can see summary
//       authorUid: user?.uid,
//       authorName: profile?.fullName || user?.displayName || user?.email || "Admin",
//       authorEmail: user?.email || null,
//       authorRole: "admin", // ✅ force admin
//       meta: {
//         level: recruit.level || null,
//         status: recruit.status || null,
//       },
//     });

//     await logRecruitActivity(recruit.id, {
//       type: "quick_log",
//       message: `Admin logged: ${label}`,
//       recruitId: recruit.id,
//       recruitName: recruit.fullName || recruit.email || recruit.id,
//       actorUid: user?.uid || null,
//       actorName: profile?.fullName || user?.displayName || user?.email || "Admin",
//       actorEmail: user?.email || null,
//       actorRole: "admin",
//       changes: [{ field: "quickLog", from: null, to: type }],
//       unreadByAdmins: false,
//     });

//     await updateDoc(doc(db, "recruits", recruit.id), {
//       lastActivityText: `Admin logged: ${label}`,
//       lastActivityAt: serverTimestamp(),
//       updatedAt: serverTimestamp(),
//       lastUpdatedByUid: user?.uid || null,
//       lastUpdatedByName: profile?.fullName || user?.displayName || user?.email || "Admin",
//       lastUpdatedByRole: "admin",
//       lastUpdatedAt: serverTimestamp(),
//     });
//     // ✅ After successful update, ask admin if they want to email the agent
// // if (isAdmin) {
// //   const assignedEmail = after.assignedAgentEmail || recruit.assignedAgentEmail;
// //   const assignedName = after.assignedAgentName || recruit.assignedAgentName;

// //   const changesSummary =
// //     publicChanges.length > 0
// //       ? `Admin updated: ${publicChanges.map((c) => c.field).join(", ")}`
// //       : "Admin saved the recruit.";

// //   const actionItemDueText = actionItemDueAt ? fmtDateShort(actionItemDueAt) : null;

// //   // Only prompt if something meaningful happened (optional)
// //   const shouldPrompt = changes.length > 0 || actionChanged;

// //   if (shouldPrompt) {
// //     maybePromptEmailAssignedAgent({
// //       recruit: { ...recruit, ...after, id: recruit.id },
// //       assignedAgentEmail: assignedEmail,
// //       assignedAgentName: assignedName,
// //       changesSummary,
// //       actionItemDueText,
// //     });
// //   }
// // }
//   } catch (e) {
//     console.error("Quick log failed:", e);
//     alert(e?.message || "Quick log failed. Check console.");
//   }
// }

  const [recruit, setRecruit] = useState(null);
  const [loading, setLoading] = useState(true);

  // agent-editable
  const [relationshipRank, setRelationshipRank] = useState("0% or new lead");
  const [urgencyRank, setUrgencyRank] = useState("Not sure");
  const [status, setStatus] = useState("Engagement Phase");
  const [saving, setSaving] = useState(false);
const [level, setLevel] = useState(1);
const [levelOfUrgency, setLevelOfUrgency] = useState(1);

  // admin-editable
  const [adminForm, setAdminForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    status: "Engagement Phase",
    source: "Other",
    office: "",
    nextFollowUpDate: "",
    actionItemText: "",
    actionItemDueDate: "",
    assignedAgentUid: "",
    relationshipRank: "0% or new lead",
    urgencyRank: "Not sure",
    level: "",
    levelOfUrgency: 1,
    // Courted fields
    currentOffice: "",
    potential: "",
    yearsInIndustry: "",
    yearsInOffice: "",
    ltmSalesVolume: "",
    ltmSalesVolumeGrowthPct: "",
  });

  const [adminSaving, setAdminSaving] = useState(false);

  useEffect(() => {
    if (!recruitId) return;
    const ref = doc(db, "recruits", recruitId);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        setRecruit(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setLoading(false);
      },
      (err) => {
        console.error("RecruitDetailView listener:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [recruitId]);

  useEffect(() => {
    if (!recruit) return;


    setRelationshipRank(recruit.relationshipRank || "0% or new lead");
    setUrgencyRank(recruit.urgencyRank || "Not sure");
    setStatus(recruit.status || "Engagement Phase");
setLevel(normalizeLevel(recruit.level));
setLevelOfUrgency(normalizeUrgencyLevel(recruit.levelOfUrgency));

    setAdminForm({
      firstName: recruit.firstName || "",
      lastName: recruit.lastName || "",
      email: recruit.email || "",
      phone: recruit.phone || "",
      status: recruit.status || "Engagement Phase",
      source: recruit.source || "Other",
      office: recruit.office || "",
      nextFollowUpDate: toInputDate(recruit.nextFollowUpAt),
      actionItemText: recruit.actionItemText || "",
      actionItemDueDate: toInputDate(recruit.actionItemDueAt),
      assignedAgentUid: recruit.assignedAgentUid || "",
      relationshipRank: recruit.relationshipRank || "0% or new lead",
      urgencyRank: recruit.urgencyRank || "Not sure",
level: normalizeLevel(recruit.level),
levelOfUrgency: normalizeUrgencyLevel(recruit.levelOfUrgency),
      currentOffice: recruit.currentOffice || "",
      potential: recruit.potential || "",
      yearsInIndustry: recruit.yearsInIndustry ?? "",
      yearsInOffice: recruit.yearsInOffice ?? "",
      ltmSalesVolume: recruit.ltmSalesVolume ?? "",
      ltmSalesVolumeGrowthPct: recruit.ltmSalesVolumeGrowthPct ?? "",
    });
  }, [recruit]);

  const title = useMemo(() => {
    if (!recruit) return "Recruit";
    return recruit.fullName || `${recruit.firstName || ""} ${recruit.lastName || ""}`.trim() || recruit.email || "Recruit";
  }, [recruit]);

  function setAdminField(key, value) {
    setAdminForm((p) => ({ ...p, [key]: value }));
  }

function handleEmailAssignedAgent() {
  const assignedAgentEmail = recruit?.assignedAgentEmail;

  if (!assignedAgentEmail) {
    alert("No assigned agent email found. Assign an agent first.");
    return;
  }

  const recruitNameForEmail =
    `${adminForm.firstName || ""} ${adminForm.lastName || ""}`.trim() ||
    recruit?.fullName ||
    recruit?.email ||
    recruit?.id ||
    "Recruit";

  const currentUrgencyLevel = normalizeUrgencyLevel(
    adminForm.levelOfUrgency ?? recruit?.levelOfUrgency
  );

  const currentPhone =
    (adminForm.phone || "").trim() || recruit?.phone || "—";

  const currentEmail =
    (adminForm.email || "").trim().toLowerCase() || recruit?.email || "—";

  const currentActionItemText =
    (adminForm.actionItemText || "").trim() || recruit?.actionItemText || null;

  const currentActionItemDueText = adminForm.actionItemDueDate
    ? fmtDateShort(inputDateToDateOrNull(adminForm.actionItemDueDate))
    : recruit?.actionItemDueAt
    ? fmtDateShort(recruit.actionItemDueAt)
    : null;

  maybePromptEmailAssignedAgent({
    assignedAgentEmail,
    recruitName: recruitNameForEmail,
    recruitId: recruit?.id,
    recruitPhone: currentPhone,
    recruitEmail: currentEmail,
    urgencyLevel: currentUrgencyLevel,
    actionItemText: currentActionItemText,
    actionItemDueText: currentActionItemDueText,
  });
}

  async function handleAdminSave() {
    if (!recruit) return;

    setAdminSaving(true);
    try {
      const yearsInIndustry = toNumberOrNull(adminForm.yearsInIndustry);
      const yearsInOffice = toNumberOrNull(adminForm.yearsInOffice);
      const ltmSalesVolume = toNumberOrNull(adminForm.ltmSalesVolume);
      const ltmSalesVolumeGrowthPct = toPercentNumberOrNull(adminForm.ltmSalesVolumeGrowthPct);
const recruitName = getRecruitDisplayName(recruit);

      const currentOffice = (adminForm.currentOffice || "").trim() || null;
      const potential = (adminForm.potential || "").trim() || null;

      const fn = adminForm.firstName.trim();
      const ln = adminForm.lastName.trim();
      const fullName = `${fn} ${ln}`.trim() || null;
const lvlNorm = normalizeLevel(adminForm.level); // should be "" or "0"/"1"/"2"/"3"
const levelToSave = lvlNorm === "" ? null : Number(lvlNorm);
const levelOfUrgencyToSave = normalizeUrgencyLevel(adminForm.levelOfUrgency);
      const recruitNameForEmail =
  fullName ||
  recruit.fullName ||
  `${recruit.firstName || ""} ${recruit.lastName || ""}`.trim() ||
  recruit.email ||
  recruit.id ||
  "Recruit";
      const agentUid = adminForm.assignedAgentUid || null;
      const a = agentUid ? agents.find((x) => x.id === agentUid) : null;

   const actionItemDueAt = adminForm.actionItemDueDate
  ? inputDateToDateOrNull(adminForm.actionItemDueDate)
  : null;

// if you want “integrated” behavior:
const nextFollowUpAt = actionItemDueAt || (adminForm.nextFollowUpDate
  ? inputDateToDateOrNull(adminForm.nextFollowUpDate)
  : null);

      const actionItemText = (adminForm.actionItemText || "").trim() || null;

      const before = {
        firstName: recruit.firstName || null,
        lastName: recruit.lastName || null,
        fullName: recruit.fullName || null,
        email: recruit.email || null,
        phone: recruit.phone || null,
        status: recruit.status || null,
        source: recruit.source || null,
        office: recruit.office || null,
        relationshipRank: recruit.relationshipRank || null,
        urgencyRank: recruit.urgencyRank || null,
level: normalizeLevel(recruit.level),
levelOfUrgency: normalizeUrgencyLevel(recruit.levelOfUrgency),
        nextFollowUpAt: fmtDateShort(recruit.nextFollowUpAt),
        actionItemText: recruit.actionItemText || null,
        actionItemDueAt: fmtDateShort(recruit.actionItemDueAt),
        assignedAgentUid: recruit.assignedAgentUid || null,
        assignedAgentEmail: recruit.assignedAgentEmail || null,
        assignedAgentName: recruit.assignedAgentName || null,
        currentOffice: recruit.currentOffice || null,
        potential: recruit.potential || null,
        yearsInIndustry: recruit.yearsInIndustry ?? null,
        yearsInOffice: recruit.yearsInOffice ?? null,
        ltmSalesVolume: recruit.ltmSalesVolume ?? null,
        ltmSalesVolumeGrowthPct: recruit.ltmSalesVolumeGrowthPct ?? null,
      };

      const after = {
        firstName: fn || null,
        lastName: ln || null,
        fullName,
        email: adminForm.email.trim().toLowerCase() || null,
        phone: adminForm.phone.trim() || null,
        status: adminForm.status || "Engagement Phase",
        source: adminForm.source || "Other",
        office: adminForm.office || null,
        relationshipRank: adminForm.relationshipRank || "0% or new lead",
        urgencyRank: adminForm.urgencyRank || "Not sure",
        nextFollowUpAt: nextFollowUpAt ? fmtDateShort(nextFollowUpAt) : "—",
        actionItemText: actionItemText || null,
        actionItemDueAt: actionItemDueAt ? fmtDateShort(actionItemDueAt) : "—",
        assignedAgentUid: a ? a.id : null,
        assignedAgentEmail: a?.email?.trim() || null,
        assignedAgentName: a?.fullName || null,
      level: levelToSave,
      levelOfUrgency: levelOfUrgencyToSave,
        currentOffice,
        potential,
        yearsInIndustry,
        yearsInOffice,
        ltmSalesVolume,
        ltmSalesVolumeGrowthPct,
      };

      const changes = diffChanges(before, after);
      const publicChanges = changes.filter((c) => c.field !== "actionItemText" && c.field !== "actionItemDueAt");

      // ✅ ONE clean updateDoc (no duplicates)
      await updateDoc(doc(db, "recruits", recruit.id), {
        firstName: after.firstName,
        lastName: after.lastName,
        fullName: after.fullName,
        email: after.email,
        phone: after.phone,

        status: after.status,
        source: after.source,
        office: after.office,

        relationshipRank: after.relationshipRank,
        urgencyRank: after.urgencyRank,
level: after.level,
levelOfUrgency: after.levelOfUrgency,
        nextFollowUpAt: nextFollowUpAt ? nextFollowUpAt : null,
        actionItemText,
        actionItemDueAt: actionItemDueAt ? actionItemDueAt : null,
        actionItemUpdatedAt: serverTimestamp(),

        assignedAgentUid: after.assignedAgentUid,
        assignedAgentEmail: after.assignedAgentEmail,
        assignedAgentName: after.assignedAgentName,
        assignedAt: a ? serverTimestamp() : null,

        currentOffice,
        potential,
        yearsInIndustry,
        yearsInOffice,
        ltmSalesVolume,
        ltmSalesVolumeGrowthPct,

        lastActivityText: publicChanges.length
          ? `Admin updated: ${publicChanges.map((c) => c.field).join(", ")}`
          : "Admin clicked save (no changes)",
        lastActivityAt: serverTimestamp(),
        updatedAt: serverTimestamp(),

        lastUpdatedByUid: user?.uid || null,
        lastUpdatedByName: profile?.fullName || user?.displayName || user?.email || "Admin",
        lastUpdatedByRole: "admin",
        lastUpdatedAt: serverTimestamp(),
        lastAdminTouchedAt: serverTimestamp(),
lastAdminTouchedByUid: user?.uid || null,
lastAdminTouchedByName:
  profile?.fullName || user?.displayName || user?.email || "Admin",
      });

      // Admin-only journal entry if action item changed
      const actionChanged = changes.some((c) => c.field === "actionItemText" || c.field === "actionItemDueAt");
      if (actionChanged) {
        const journalRef = collection(db, "recruits", recruit.id, "journal");
        const dueText = actionItemDueAt ? fmtDateShort(actionItemDueAt) : "—";
        const msg = actionItemText
          ? `Action Item updated (due ${dueText}): ${actionItemText}`
          : `Action Item cleared (was due ${dueText}).`;

        await addDoc(journalRef, {
          text: msg,
          type: "action-item",
          visibility: "admin",
          authorUid: user?.uid || null,
          authorName: profile?.fullName || user?.displayName || user?.email || "Admin",
          authorEmail: user?.email || null,
          authorRole: "admin",
          createdAt: serverTimestamp(),
        });
      }

      // ✅ Activity feed log (your Cloud Function should create recruitEvents from this)
      if (changes.length) {
        await logRecruitActivity(recruit.id, {
          type: "field_update",
          message: `Admin updated ${changes.length} field(s)`,
           recruitId: recruit.id,
   recruitName: recruitName || "Recruit",
          actorUid: user?.uid || null,
          actorName: profile?.fullName || user?.displayName || "Admin",
          actorEmail: user?.email || null,
          actorRole: "admin",
          changes,
        });
      }
    } catch (e) {
      console.error("handleAdminSave error:", e);
      alert("Admin save failed. Check console.");
    } finally {
      setAdminSaving(false);
    }
  }

async function handleAdminSaveActionOnly() {
  if (!recruit) return;

  setAdminSaving(true);
  try {
    const adminName =
      profile?.fullName || user?.displayName || user?.email || "Admin";

    const actionItemText = (adminForm.actionItemText || "").trim() || null;
    const actionItemDueAt = adminForm.actionItemDueDate
      ? inputDateToDateOrNull(adminForm.actionItemDueDate)
      : null;

    await updateDoc(doc(db, "recruits", recruit.id), {
      actionItemText,
      actionItemDueAt,
      nextFollowUpAt: actionItemDueAt ? actionItemDueAt : null,
      actionItemUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      lastUpdatedByUid: user?.uid || null,
      lastUpdatedByName: adminName,
      lastUpdatedByRole: "admin",
      lastUpdatedAt: serverTimestamp(),

      lastActivityText: "Admin updated action item",
      lastActivityAt: serverTimestamp(),

      lastAdminTouchedAt: serverTimestamp(),
      lastAdminTouchedByUid: user?.uid || null,
      lastAdminTouchedByName: adminName,
    });
  } finally {
    setAdminSaving(false);
  }
}

async function handleAdminClearActionItem() {
  if (!recruit) return;

  const ok = window.confirm("Clear the action item and due date for this recruit?");
  if (!ok) return;

  const adminName =
    profile?.fullName || user?.displayName || user?.email || "Admin";

  setAdminSaving(true);
  try {
    await updateDoc(doc(db, "recruits", recruit.id), {
      actionItemText: null,
      actionItemDueAt: null,
      nextFollowUpAt: null,
      actionItemUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      lastUpdatedByUid: user?.uid || null,
      lastUpdatedByName: adminName,
      lastUpdatedByRole: "admin",
      lastUpdatedAt: serverTimestamp(),

      lastActivityText: "Admin cleared action item",
      lastActivityAt: serverTimestamp(),

      lastAdminTouchedAt: serverTimestamp(),
      lastAdminTouchedByUid: user?.uid || null,
      lastAdminTouchedByName: adminName,
    });

    setAdminForm((prev) => ({
      ...prev,
      actionItemText: "",
      actionItemDueDate: "",
      nextFollowUpDate: "",
    }));
  } catch (e) {
    console.error("handleAdminClearActionItem error:", e);
    alert(e?.message || "Could not clear action item.");
  } finally {
    setAdminSaving(false);
  }
}

async function handleAgentSave() {
  if (!recruit) return;

  setSaving(true);
  try {
    const beforeStatus = recruit.status || "Engagement Phase";
const beforeLevel = recruit.level;

const parts = [];
const lvlNorm = normalizeLevel(level); // returns "" or "0"/"1"/"2"/"3"
const levelToSave = lvlNorm === "" ? null : Number(lvlNorm);
const beforePhase = levelToPhase(beforeLevel);
const afterPhase = levelToPhase(levelToSave);
const beforeUrgencyLevel = normalizeUrgencyLevel(recruit.levelOfUrgency);
const afterUrgencyLevel = normalizeUrgencyLevel(levelOfUrgency);

// Only log phase change if it actually changed
if (beforePhase !== afterPhase) {
  parts.push(`Phase changed from "${beforePhase}" to "${afterPhase}"`);
}
if (beforeUrgencyLevel !== afterUrgencyLevel) {
  parts.push(
    `Scheduling Priority Level changed from "${urgencyLevelPillLabel(beforeUrgencyLevel)}" to "${urgencyLevelPillLabel(afterUrgencyLevel)}"`
  );
}
    if (String(beforeStatus) !== String(status)) {
      parts.push(`Status changed from "${beforeStatus}" to "${status}"`);
    }

    if (String(recruit.relationshipRank || "") !== String(relationshipRank)) {
      parts.push(`Relationship updated to "${relationshipRank}"`);
    }

    if (String(recruit.urgencyRank || "") !== String(urgencyRank)) {
      parts.push(`Urgency updated to "${urgencyRank}"`);
    }

    const activityText =
      parts.length > 0 ? parts.join(" • ") : "Agent clicked save (no changes)";

    const actorName =
      profile?.fullName || user?.displayName || user?.email || "Agent";

    // ✅ 1) Update recruit doc (grid + detail header pulls from this)
 // normalize level so Firestore always gets: 0/1/2/3 OR null


await updateDoc(doc(db, "recruits", recruit.id), {
  relationshipRank,
  urgencyRank,
  status,
  level: levelToSave, // ✅ this is the fix
levelOfUrgency: afterUrgencyLevel,
  lastActivityText: activityText,
  lastActivityAt: serverTimestamp(),
  updatedAt: serverTimestamp(),

  lastUpdatedByUid: user?.uid || null,
  lastUpdatedByName: actorName,
  lastUpdatedByRole: "agent",
  lastUpdatedAt: serverTimestamp(),
});

    // ✅ 2) Log activity (this is what your alerts pipeline is likely using)
    const changes = [
      ...(String(beforeStatus) !== String(status)
        ? [{ field: "status", from: beforeStatus, to: status }]
        : []),
    ...(beforePhase !== afterPhase
  ? [{ field: "phase", from: beforePhase, to: afterPhase }]
  : []),
  ...(beforeUrgencyLevel !== afterUrgencyLevel
  ? [{ field: "levelOfUrgency", from: beforeUrgencyLevel, to: afterUrgencyLevel }]
  : []),
      ...(String(recruit.relationshipRank || "") !== String(relationshipRank)
        ? [{ field: "relationshipRank", from: recruit.relationshipRank || null, to: relationshipRank }]
        : []),
      ...(String(recruit.urgencyRank || "") !== String(urgencyRank)
        ? [{ field: "urgencyRank", from: recruit.urgencyRank || null, to: urgencyRank }]
        : []),
    ];

   const recruitName =
  recruit.fullName ||
  `${recruit.firstName || ""} ${recruit.lastName || ""}`.trim() ||
  recruit.email ||
  recruit.id ||
  "Recruit";

await logRecruitActivity(recruit.id, {
  type: "agent_update",
  message: activityText,

  // ✅ add these (this is what your AdminDashboard UI needs)
  recruitId: recruit.id,
  recruitName,

  actorUid: user?.uid || null,
  actorName,
  actorEmail: user?.email || null,
  actorRole: profile?.role || "agent",

  changes,
  unreadByAdmins: true, // ✅ so it shows as NEW
});


    // OPTIONAL: If you *also* want it in RecruitActivityFeed, keep this.
    // But ONLY if your feed reads from recruits/{id}/events:
    if (changes.length > 0) {
      await addDoc(collection(db, "recruits", recruit.id, "events"), {
        type: "agent_update",          // ✅ not "note"
        text: activityText,            // ✅ same message
        visibility: "shared",
        createdAt: serverTimestamp(),
        authorUid: user?.uid,
        authorName: actorName,
        authorEmail: user?.email || null,
        authorRole: profile?.role || "agent",
        changes,                       // ✅ helpful for UI
      });
    }
  } catch (err) {
    console.error("handleAgentSave error:", err);
    alert(err?.message || "Could not save changes. Check console.");
  } finally {
    setSaving(false);
  }
}



  async function handleAdminDelete() {
    if (!recruit) return;
    const ok = window.confirm(`Delete recruit?\n\n${title}\n\nThis deletes the recruit record. (Journal may remain unless we add a delete function.)`);
    if (!ok) return;

    await deleteDoc(doc(db, "recruits", recruit.id));
    onBack?.();
  }

if (loading) return <div className="p-6">Loading…</div>;
if (!recruit) return <div className="p-6">Recruit not found.</div>;

const actionMomentum = momentumStatus({
  nextFollowUpAt: recruit.nextFollowUpAt,
  lastActivityAt: recruit.lastActivityAt,
});

const dueText = recruit.actionItemDueAt ? tsToText(recruit.actionItemDueAt) : "—";

return (
  <div className="min-h-screen bg-[var(--color-wrcGray)]">
    {/* header */}
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6 py-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-gray-500">Weichert Realtors Cornerstone</div>
          <div className="text-2xl font-extrabold text-[var(--color-wrcBlack)]">{title}</div>

          <div className="text-sm text-gray-600">
            Recruit ID: <span className="font-mono">{recruit.id}</span>
          </div>

          <div className="text-sm text-gray-600">
            Assigned agent: <span className="font-semibold">{recruit.assignedAgentName || "—"}</span>
            {recruit.assignedAgentEmail ? (
              <span className="text-gray-500"> • {recruit.assignedAgentEmail}</span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone="blue">{recruit.status || "Status"}</Pill>
            <Pill tone={urgencyLevelTone(recruit.levelOfUrgency)}>
              {urgencyLevelPillLabel(recruit.levelOfUrgency)}
            </Pill>
            <Pill tone="gray">{recruit.relationshipRank || "Relationship"}</Pill>
            <Pill tone={urgencyTone(recruit.urgencyRank)}>
              {recruit.urgencyRank || "Urgency"}
            </Pill>
          </div>

          {!isAdmin && (
            <div className="mt-4">
              <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
                  Latest Activity
                </div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {recruit.lastActivityText || "—"}
                </div>
                <div className="mt-1 text-xs text-gray-500">{tsToText(recruit.lastActivityAt)}</div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-full border border-gray-300 bg-white hover:bg-gray-50"
          >
            ← Back
          </button>

          {isAdmin && (
            <button
              onClick={handleAdminDelete}
              className="px-4 py-2 rounded-full border border-red-200 text-red-700 bg-white hover:bg-red-50"
            >
              Delete recruit
            </button>
          )}
        </div>
      </div>
    </div>

    {/* full-width action item */}
    <div className="max-w-6xl mx-auto px-6 pt-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold tracking-wide text-gray-600 uppercase">
              Action Item
            </div>

            {isAdmin ? (
              <>
                <div className="mt-2">
                  <textarea
                    value={adminForm.actionItemText}
                    onChange={(e) => setAdminField("actionItemText", e.target.value)}
                    placeholder="Type directions for the agent…"
                    className="w-full px-3 py-2 rounded-md border border-gray-200 min-h-[90px]"
                  />
                </div>

                <div className="mt-3">
                  <div className="text-sm font-semibold text-gray-700">Action Item due date</div>
                  <input
                    type="date"
                    value={adminForm.actionItemDueDate}
                    onChange={(e) => setAdminField("actionItemDueDate", e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-gray-500">
                    Current due: <span className="font-semibold">{dueText}</span>
                  </div>

            <div className="flex flex-wrap gap-2">
  <button
    type="button"
    onClick={handleAdminSaveActionOnly}
    disabled={adminSaving}
    className="px-5 py-2 rounded-md bg-black text-[var(--color-wrcYellowUI)] font-extrabold disabled:opacity-60"
  >
    {adminSaving ? "Saving…" : "Save Action Item"}
  </button>

  <button
    type="button"
    onClick={handleAdminClearActionItem}
    disabled={adminSaving}
    className="px-5 py-2 rounded-md border border-red-200 bg-white text-red-700 font-extrabold hover:bg-red-50 disabled:opacity-60"
  >
    Clear Action Item
  </button>
</div>
                </div>
              </>
            ) : (
              (() => {
                const hasAction =
                  (recruit.actionItemText || "").trim() || recruit.actionItemDueAt;

                if (!hasAction) {
                  return (
                    <div className="mt-2 text-sm text-gray-700">
                      No action item set yet.
                    </div>
                  );
                }

                return (
                  <>
                    <div className="mt-2 text-lg font-extrabold text-[var(--color-wrcBlack)] whitespace-pre-wrap">
                      {recruit.actionItemText || "—"}
                    </div>

                    <div className="mt-2 text-sm text-gray-700">
                      Next Required Follow-Up: <span className="font-semibold">{dueText}</span>
                    </div>
                  </>
                );
              })()
            )}
          </div>

          <div className="shrink-0">
            {actionMomentum.needsAttention ? (
              <div className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-3 py-1 rounded-full">
                Needs attention
              </div>
            ) : (
              <div className="text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-3 py-1 rounded-full">
                On track
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    <div className="max-w-6xl mx-auto p-6">
      <div className="grid gap-6 lg:grid-cols-3">
          {/* left */}
          <div className="lg:col-span-2 space-y-6">
            {/* ✅ RESTORED ADMIN FORM */}
            {isAdmin ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="text-lg font-bold text-[var(--color-wrcBlack)]">Recruit details</div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-sm font-semibold text-gray-700">First name</div>
                    <input
                      value={adminForm.firstName}
                      onChange={(e) => setAdminField("firstName", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    />
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Last name</div>
                    <input
                      value={adminForm.lastName}
                      onChange={(e) => setAdminField("lastName", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    />
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Email</div>
                    <input
                      value={adminForm.email}
                      onChange={(e) => setAdminField("email", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    />
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Phone</div>
                    <input
                      value={adminForm.phone}
                      onChange={(e) => setAdminField("phone", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    />
                  </div>

                  {/* Imported profile fields */}
                  <div className="md:col-span-2 pt-2">
                    <div className="text-sm font-bold text-gray-800">Imported profile fields</div>
                    <div className="text-xs text-gray-500">These match the Courted columns and your grid.</div>
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Current office</div>
                    <input
                      value={adminForm.currentOffice}
                      onChange={(e) => setAdminField("currentOffice", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                      placeholder="e.g., Compass, KW, etc."
                    />
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Potential to move</div>
                    <input
                      value={adminForm.potential}
                      onChange={(e) => setAdminField("potential", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                      placeholder="High / Likely / Not sure / Low"
                    />
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Years in industry</div>
                    <input
                      value={adminForm.yearsInIndustry}
                      onChange={(e) => setAdminField("yearsInIndustry", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    />
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Years in current office</div>
                    <input
                      value={adminForm.yearsInOffice}
                      onChange={(e) => setAdminField("yearsInOffice", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    />
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">LTM sales volume</div>
                    <input
                      value={adminForm.ltmSalesVolume}
                      onChange={(e) => setAdminField("ltmSalesVolume", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    />
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">LTM growth %</div>
                    <input
                      value={adminForm.ltmSalesVolumeGrowthPct}
                      onChange={(e) => setAdminField("ltmSalesVolumeGrowthPct", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                      placeholder="e.g., 12 or -15"
                    />
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Relationship ranking</div>
                    <select
                      value={adminForm.relationshipRank}
                      onChange={(e) => setAdminField("relationshipRank", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    >
                      {RELATIONSHIP_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Urgency likelihood</div>
                    <select
                      value={adminForm.urgencyRank}
                      onChange={(e) => setAdminField("urgencyRank", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    >
                      {URGENCY_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
{/* ✅ Admin Recruit level */}
<div className="md:col-span-2">
  <div className="text-sm font-semibold text-gray-700">Phase</div>
  <PhaseDropdown
    value={adminForm.level}
    onChange={(nextLevel) => setAdminField("level", nextLevel)}
  />
</div>

<div className="md:col-span-2">
  <div className="text-sm font-semibold text-gray-700">Scheduling Priority Level</div>
  <UrgencyLevelDropdown
    value={adminForm.levelOfUrgency}
    onChange={(nextLevel) => setAdminField("levelOfUrgency", nextLevel)}
  />
</div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Status</div>
                    <select
                      value={adminForm.status}
                      onChange={(e) => setAdminField("status", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Source</div>
                    <select
                      value={adminForm.source}
                      onChange={(e) => setAdminField("source", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    >
                      {SOURCE_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Office</div>
                    <input
                      value={adminForm.office}
                      onChange={(e) => setAdminField("office", e.target.value)}
                      placeholder="Blue Bell, Wayne, etc."
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    />
                  </div>

                  {/* <div>
                    <div className="text-sm font-semibold text-gray-700">Next follow-up</div>
                    <input
                      type="date"
                      value={adminForm.nextFollowUpDate}
                      onChange={(e) => setAdminField("nextFollowUpDate", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    />
                  </div> */}

                  {/* <div className="md:col-span-2">
                    <div className="text-sm font-semibold text-gray-700">Action Item (agent sees this)</div>
                    <textarea
                      value={adminForm.actionItemText}
                      onChange={(e) => setAdminField("actionItemText", e.target.value)}
                      placeholder="Type directions for the agent…"
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200 min-h-[90px]"
                    />
                    {isAdmin && (
                 <div className="mt-2 flex items-center gap-2">
                    <a
              href={
             recruit?.assignedAgentEmail
               ? buildActionItemMailto({
                agentEmail: recruit.assignedAgentEmail,
               recruit,
              urgencyLabel: recruit.urgencyRank,
               actionItemText: adminForm.actionItemText,
               appBaseUrl: "https://wrc-recruits.web.app", // ✅ change if needed
             })
            : undefined
      }
      onClick={(e) => {
        if (!recruit?.assignedAgentEmail) {
          e.preventDefault();
          alert("No agent email found. Assign an agent first.");
        }
      }}
      className="px-4 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold"
      title="Opens your email app with a pre-filled message"
    >
      Email Agent
    </a>

    <div className="text-xs text-gray-500">
      Opens Outlook/Gmail with a pre-filled email. You still click Send.
    </div>
  </div>
)}

                  </div> */}

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Action Item due date</div>
                    <input
                      type="date"
                      value={adminForm.actionItemDueDate}
                      onChange={(e) => setAdminField("actionItemDueDate", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    />
                  </div>

                  {/* Assignment inside the admin form as well (optional, but you had it separately too) */}
                  <div>
                    <div className="text-sm font-semibold text-gray-700">Assign to</div>
                    <select
                      value={adminForm.assignedAgentUid}
                      onChange={(e) => setAdminField("assignedAgentUid", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    >
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.fullName || a.email}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-xs text-gray-500">Assignment is applied when you click “Save changes.”</div>
                  </div>
                </div>

           <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
  <div className="text-sm text-gray-600">Save changes to apply updates.</div>

  <div className="flex flex-wrap items-center gap-2">
<div className="relative">
  <button
    type="button"
    onClick={handleEmailAssignedAgent}
    className="px-5 py-2 rounded-md bg-black text-[var(--color-wrcYellowUI)] font-extrabold disabled:opacity-60"
  >
    Email Assigned Agent
  </button>

  <EmailAssignedAgentModal
    open={emailModalOpen}
    onClose={() => setEmailModalOpen(false)}
    onSend={handleCopyAndOpenDraft}
    agentEmail={emailPayload?.to}
    previewSubject={emailPayload?.subject}
    previewBody={emailPayload?.body}
  />
</div>

    <button
      onClick={handleAdminSave}
      disabled={adminSaving}
      className="px-5 py-2 rounded-md bg-black text-[var(--color-wrcYellowUI)] font-extrabold disabled:opacity-60"
    >
      {adminSaving ? "Saving…" : "Save changes"}
    </button>
  </div>
</div>
              </div>
            ) : (
              // Agent form
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
{/* <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
  <div className="flex items-start justify-between gap-3">
    <div>
      <div className="text-sm font-semibold text-gray-700">Action Item Due Date</div>

      <div className="mt-1 text-xs text-gray-500">
        Optional — scheduling keeps the recruit out of “Needs Attention.”
      </div>
    </div>

    <div className="text-right">
      <div className="text-xs text-gray-500">Currently</div>
      <div className="text-sm font-extrabold text-gray-900">
       {fmtFollowUpLabel(nextFollowUpAtLocal || recruit.actionItemDueAt || recruit.nextFollowUpAt)}

      </div>
    </div>
  </div>

  <div className="mt-3 flex flex-wrap gap-2">
    <button
      type="button"
      onClick={() => setActionItemDueInDays(3)}

      className="px-3 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold"
    >
      +3 days
    </button>
    <button
      type="button"
      onClick={() => setActionItemDueInDays(7)}

      className="px-3 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold"
    >
      +7 days
    </button>
    <button
      type="button"
      onClick={() => setActionItemDueInDays(14)}

      className="px-3 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold"
    >
      +14 days
    </button>

    <button
      type="button"
      onClick={async () => {
        if (!recruit?.id) return;
        setNextFollowUpAtLocal(null);
        try {
await updateDoc(doc(db, "recruits", recruit.id), {
  // ✅ integrate: clear both
  actionItemDueAt: null,
  nextFollowUpAt: null,

  nextFollowUpOwnerUid: user?.uid || null,

  lastActivityText: "Agent cleared Action Item due date",
  lastActivityAt: serverTimestamp(),
  updatedAt: serverTimestamp(),

  lastUpdatedByUid: user?.uid || null,
  lastUpdatedByName: profile?.fullName || user?.displayName || user?.email || "Agent",
  lastUpdatedByRole: "agent",
  lastUpdatedAt: serverTimestamp(),
});


        } catch (e) {
          console.error("clear follow-up failed:", e);
          alert(e?.message || "Could not clear follow-up.");
        }
      }}
      className="px-3 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold"
      title="Clear follow-up date"
    >
      Clear
    </button>
  </div>
</div> */}


                <div className="text-lg font-bold text-[var(--color-wrcBlack)]">Update This Recruit</div>
{/* <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
  <div className="flex items-start justify-between gap-3">
    <div>
      <div className="text-sm font-semibold text-gray-700">Quick Log Summary</div>
      <div className="mt-1 text-xs text-gray-500">
        Quick Log buttons are controlled by your admin.
      </div>
    </div>
  </div>

  <div className="mt-3">
    <QuickLogSummaryCard summary={quickSummary} />
  </div>
</div> */}


                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-sm font-semibold text-gray-700">Relationship ranking</div>
                    <select
                      value={relationshipRank}
                      onChange={(e) => setRelationshipRank(e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    >
                      {RELATIONSHIP_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-gray-700">Urgency ranking</div>
                    <select
                      value={urgencyRank}
                      onChange={(e) => setUrgencyRank(e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    >
                      {URGENCY_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>

<div className="md:col-span-2">
  <div className="text-sm font-semibold text-gray-700">Phase</div>
  <PhaseDropdown value={level} onChange={setLevel} />
  <div className="mt-2 text-xs text-gray-500">
    Choose the phase that best reflects where this recruit currently stands.
  </div>
</div>

<div className="md:col-span-2">
  <div className="text-sm font-semibold text-gray-700">Scheduling Priority Level</div>
  <UrgencyLevelDropdown
    value={levelOfUrgency}
    onChange={setLevelOfUrgency}
  />
</div>

                  <div className="md:col-span-2">
                    <div className="text-sm font-semibold text-gray-700">Status</div>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-md border border-gray-200"
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    onClick={handleAgentSave}
                    disabled={saving}
                    className="px-5 py-2 rounded-md bg-black text-[var(--color-wrcYellowUI)] font-extrabold disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>

                <div className="mt-2 text-xs text-gray-500">Notes are added in the Journal below.</div>
              </div>
            )}

           <RecruitJournal
  recruitId={recruit.id}
  recruitName={getRecruitDisplayName(recruit)}
  isAdmin={isAdmin}
  onAdminTouch={async (message) => {
    if (!isAdmin) return;
    await updateDoc(doc(db, "recruits", recruit.id), {
      lastActivityText: message || "Admin added a journal entry",
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastUpdatedByUid: user?.uid || null,
      lastUpdatedByName: profile?.fullName || user?.displayName || user?.email || "Admin",
      lastUpdatedByRole: "admin",
      lastUpdatedAt: serverTimestamp(),
      lastAdminTouchedAt: serverTimestamp(),
lastAdminTouchedByUid: user?.uid || null,
lastAdminTouchedByName:
  profile?.fullName || user?.displayName || user?.email || "Admin",
    });
  }}
/>



          </div>

          {/* right */}
          <div className="space-y-6">
            {/* Profile card */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-bold text-[var(--color-wrcBlack)]">Profile</div>
                <div className="text-xs text-gray-500">Imported fields</div>
              </div>

              <div className="mt-4 space-y-3">
                <InfoRow label="Current office" value={recruit.currentOffice || "—"} />

                <div className="flex items-start justify-between gap-4">
                  <div className="text-xs text-gray-500">Potential to move</div>
                  <div className="text-right">
                    <Pill tone={potentialTone(recruit.potential)}>{recruit.potential || "—"}</Pill>
                  </div>
                </div>

                <InfoRow label="Years in industry" value={numOrNull(recruit.yearsInIndustry) ?? "—"} />
                <InfoRow label="Years in current office" value={numOrNull(recruit.yearsInOffice) ?? "—"} />
                <InfoRow label="LTM sales volume" value={fmtMoney(recruit.ltmSalesVolume)} />

                <div className="flex items-start justify-between gap-4">
                  <div className="text-xs text-gray-500">LTM growth</div>
                  <div className="text-right">
                    <Pill tone={growthTone(recruit.ltmSalesVolumeGrowthPct)}>{fmtPct(recruit.ltmSalesVolumeGrowthPct)}</Pill>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="text-lg font-bold text-[var(--color-wrcBlack)]">Contact</div>
              <div className="mt-3 text-sm text-gray-800 space-y-1">
  <div>
    📞{" "}
    {recruit.phone ? (
      <a href={telHref(recruit.phone)} className="text-blue-700 hover:underline">
        {formatPhone(recruit.phone)}
      </a>
    ) : (
      <span>—</span>
    )}
  </div>

  <div>✉️ {recruit.email || "—"}</div>
</div>
            </div>
{/* Quick Log Summary (Agent view) */}

            {/* Dates */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="text-lg font-bold text-[var(--color-wrcBlack)]">Dates</div>
              <div className="mt-3 text-sm text-gray-800 space-y-3">
                <div>
                  <div className="text-xs text-gray-500">Registered</div>
                  <div className="font-semibold">{tsToText(recruit.createdAt)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Next follow-up</div>
                  <div className="font-semibold">{tsToText(recruit.nextFollowUpAt)}</div>
                </div>
              </div>
            </div>

            {isAdmin ? (
  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
    <div className="text-lg font-bold text-[var(--color-wrcBlack)]">
      Admin activity
    </div>

    <div className="mt-4 space-y-3 text-sm text-gray-800">
      <div>
        <div className="text-xs text-gray-500">Last admin touched</div>
        <div className="font-semibold">
          {recruit.lastAdminTouchedByName || "—"}
        </div>
        <div className="text-xs text-gray-500">
          {tsToText(recruit.lastAdminTouchedAt)}
        </div>
      </div>

      <div>
        <div className="text-xs text-gray-500">Last reminder sent</div>
        <div className="font-semibold">
          {recruit.lastAdminReminderSentByName || "—"}
        </div>
        <div className="text-xs text-gray-500">
          {tsToText(recruit.lastAdminReminderSentAt)}
        </div>
      </div>
    </div>
  </div>
) : null}
            {/* Activity */}
       {isAdmin ? (
  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
    <RecruitActivityFeed recruitId={recruit.id} max={75} />
  </div>
  
) : null}

{toast ? (
  <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white shadow">
    {toast}
  </div>
) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
