import React, { useEffect, useMemo, useState } from "react";
import { signOut } from "firebase/auth";
import { auth, db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  doc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import RecruitGrid from "../components/RecruitGrid";
import { normalizeLevel } from "../utils/phaseLevel";
import {
  normalizeUrgencyLevel,
  urgencyLevelPillLabel,
  urgencyLevelTone,
  urgencyLevelSortValue,
} from "../utils/urgencyLevel";
function tsToDateTime(ts) {
  if (!ts) return "";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "";
  }
}
function toDate(ts) {
  if (!ts) return null;
  try {
    return ts.toDate ? ts.toDate() : new Date(ts);
  } catch {
    return null;
  }
}

function toMillis(ts) {
  if (!ts) return null;
  try {
    if (typeof ts === "number") return ts;
    if (ts?.toMillis) return ts.toMillis();
    if (ts?.toDate) return ts.toDate().getTime();
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  } catch {
    return null;
  }
}

function isWithinDays(ts, days = 7) {
  const ms = toMillis(ts);
  if (!ms) return false;
  const cutoff = Date.now() - days * 86400000;
  return ms >= cutoff;
}

function newMeta(r, days = 7) {
  const newlyAssigned = isWithinDays(r?.assignedAt, days);
  const newlyImported = isWithinDays(r?.createdAt, days);

  // If both are true, "Newly assigned" is usually the most meaningful to the agent
  let label = null;
  let title = null;

  if (newlyAssigned) {
    label = "Newly assigned";
    title = `Assigned within the last ${days} day(s).`;
  } else if (newlyImported) {
    label = "New";
    title = `Added/imported within the last ${days} day(s).`;
  }

  return { label, title, newlyAssigned, newlyImported };
}

function callPriorityReason(r) {
  const level = normalizeUrgencyLevel(r?.levelOfUrgency);

  if (level === 5) return "Inner Sphere";
  if (level === 4) return "Outer Sphere";
  if (level === 3) return "Relationship Maintenance";
  if (level === 2) return "Relationship Building";
  return "Engagement Phase";
}
export default function AgentDashboard() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
const location = useLocation();
  const [recruits, setRecruits] = useState([]);
const recruitsById = useMemo(() => {
  const m = new Map();
  (recruits || []).forEach((r) => m.set(r.id, r));
  return m;
}, [recruits]);

  // ✅ agent alerts
  const [alerts, setAlerts] = useState([]);
  const [clearing, setClearing] = useState(false);
  const [showRead, setShowRead] = useState(false);

  const officeLabel = useMemo(() => {
    return profile?.office?.replace(/([A-Z])/g, " $1").trim() || "Office not set";
  }, [profile?.office]);

  const unreadAlerts = useMemo(() => {
    return (alerts || []).filter((a) => a.isRead !== true);
  }, [alerts]);

  const unreadCount = unreadAlerts.length;

  const visibleAlerts = useMemo(() => {
    return showRead ? alerts : unreadAlerts;
  }, [alerts, unreadAlerts, showRead]);

const callPriorityQueue = useMemo(() => {
  const active = (recruits || []).filter((r) => normalizeLevel(r?.level) !== "0");
  const rows = [...active];

  rows.sort((a, b) => {
    const aUrg = urgencyLevelSortValue(a?.levelOfUrgency);
    const bUrg = urgencyLevelSortValue(b?.levelOfUrgency);

    if (aUrg !== bUrg) return bUrg - aUrg;

    const aUpdated = toMillis(a?.updatedAt) ?? 0;
    const bUpdated = toMillis(b?.updatedAt) ?? 0;
    return bUpdated - aUpdated;
  });

  return rows;
}, [recruits]);

async function handleLogout() {
  await signOut(auth);
  navigate("/login", { replace: true });
}

  // ✅ Existing recruits listener (unchanged)
  useEffect(() => {
    if (!user?.uid) return;

    const agentUid = user.uid;
    const agentEmailNorm = (user.email || "").trim().toLowerCase();

    const ref = collection(db, "recruits");

    const qUid = query(ref, where("assignedAgentUid", "==", agentUid));
    const qEmail = agentEmailNorm
      ? query(ref, where("assignedAgentEmail", "==", agentEmailNorm))
      : null;

    let rowsUid = [];
    let rowsEmail = [];

    const mergeAndSet = () => {
      const map = new Map();
      for (const r of rowsUid) map.set(r.id, r);
      for (const r of rowsEmail) map.set(r.id, r);

      const merged = Array.from(map.values()).sort((a, b) => {
        const av = a.updatedAt?.toMillis?.() ?? 0;
        const bv = b.updatedAt?.toMillis?.() ?? 0;
        return bv - av;
      });

      setRecruits(merged);
    };

    const unsubUid = onSnapshot(
      qUid,
      (snap) => {
        rowsUid = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        mergeAndSet();
      },
      (err) => console.error("AgentDashboard UID query error:", err)
    );

    let unsubEmail = null;
    if (qEmail) {
      unsubEmail = onSnapshot(
        qEmail,
        (snap) => {
          rowsEmail = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          mergeAndSet();
        },
        (err) => console.error("AgentDashboard EMAIL query error:", err)
      );
    }

    return () => {
      unsubUid();
      if (unsubEmail) unsubEmail();
    };
  }, [user?.uid, user?.email]);

  // ✅ Agent notifications listener
  useEffect(() => {
    if (!user?.uid) return;

    const qAlerts = query(
      collection(db, "agentNotifications"),
      where("agentUid", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(50)
    );

    const unsub = onSnapshot(
      qAlerts,
      (snap) => setAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("AgentDashboard alerts error:", err)
    );

    return () => unsub();
  }, [user?.uid]);

  const headerBlack = "text-[var(--color-wrcBlack)]";
  const stripeYellow = "bg-[var(--color-wrcYellowUI)]";

  async function markAlertRead(alertId) {
    if (!alertId) return;
    try {
      await updateDoc(doc(db, "agentNotifications", alertId), { isRead: true });
    } catch (e) {
      console.error("Failed to mark alert read:", e);
    }
  }

  async function clearAllUnread() {
    if (!unreadAlerts.length) return;

    setClearing(true);
    try {
      const batch = writeBatch(db);
      unreadAlerts.forEach((a) => {
        batch.update(doc(db, "agentNotifications", a.id), { isRead: true });
      });
      await batch.commit();
    } catch (e) {
      console.error("Failed to clear all alerts:", e);
      alert("Could not clear alerts (check permissions / console).");
    } finally {
      setClearing(false);
      setShowRead(false); // after clearing, go back to unread-only view
    }
  }
function openRecruit(recruitId) {
  if (!recruitId) return;

  navigate(`/agent/recruit/${recruitId}`, {
    state: {
      backgroundLocation: location,
      dashboardState: {
        scrollY: window.scrollY,
        // optional: if you ever add agent filters/search later, store them here too
      },
    },
  });
}
  async function handleOpenAlert(a) {
    // mark read (non-blocking)
    if (a?.id && a?.isRead !== true) {
      markAlertRead(a.id);
    }

    // navigate
  if (a?.recruitId) {
  openRecruit(a.recruitId);
}
  }

  return (
    <div className="min-h-screen bg-[var(--color-wrcGray)]">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl ${stripeYellow} border border-black/10`} />
            <div>
              <div className="text-xs text-gray-500">Weichert Realtors Cornerstone</div>
              <div className={`text-lg font-extrabold ${headerBlack}`}>WRC Recruits</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className={`text-sm font-semibold ${headerBlack}`}>
                {profile?.fullName || user?.displayName || "Agent"}
              </div>
              <div className="text-xs text-gray-500">
                {officeLabel} • {user?.email}
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-md bg-black text-white font-semibold hover:opacity-90"
            >
              Logout
            </button>
          </div>
        </div>
        <div className={`h-2 ${stripeYellow}`} />
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* ✅ Alerts panel */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className={`text-lg font-extrabold ${headerBlack}`}>Alerts</div>
              <div className="text-xs text-gray-500">
                Updates from your admin (Action Items, status changes, urgency updates)
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold">
                Unread:{" "}
                <span
                  className={`inline-flex items-center px-2 py-1 rounded-full ${
                    unreadCount > 0
                      ? "bg-yellow-100 text-yellow-900"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {unreadCount}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowRead((v) => !v)}
                className="px-3 py-2 rounded-md text-sm font-semibold border border-gray-300 text-gray-800 hover:bg-gray-50"
              >
                {showRead ? "Hide Read" : "Show Read"}
              </button>

              <button
                type="button"
                onClick={clearAllUnread}
                disabled={clearing || unreadCount === 0}
                className={`px-3 py-2 rounded-md text-sm font-semibold border ${
                  clearing || unreadCount === 0
                    ? "border-gray-200 text-gray-400 cursor-not-allowed bg-gray-50"
                    : "border-gray-300 text-gray-800 hover:bg-gray-50"
                }`}
                title="Mark all unread alerts as read"
              >
                {clearing ? "Clearing..." : "Clear All"}
              </button>
            </div>
          </div>

          <div className="mt-4 max-h-[260px] overflow-auto space-y-2">
            {visibleAlerts.length === 0 ? (
              <div className="text-sm text-gray-600">
                {showRead ? "No alerts yet." : "No unread alerts 🎉"}
              </div>
            ) : (
              // ✅ IMPORTANT FIX: use visibleAlerts, not alerts
visibleAlerts.map((a) => {
  const r = a?.recruitId ? recruitsById.get(a.recruitId) : null;
  const n = r ? newMeta(r, 7) : null;
  return (
    <div
      key={a.id}
      className={`rounded-xl border px-4 py-3 transition ${
        a.isRead ? "border-gray-200 bg-white" : "border-yellow-300 bg-yellow-50"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <button
          type="button"
          onClick={() => handleOpenAlert(a)}
          className="min-w-0 text-left flex-1"
        >
  <div className="flex items-center gap-2 min-w-0">
  <div className="text-sm font-semibold text-gray-900 truncate">
    {a.message || "Update"}
  </div>

  {n?.label ? (
    <span
      className="shrink-0 text-[11px] font-extrabold px-2 py-1 rounded-full border bg-blue-50 border-blue-200 text-blue-800"
      title={n.title}
    >
      {n.label}
    </span>
  ) : null}
</div>
{n?.label ? (
  <span
    className="shrink-0 text-[11px] font-extrabold px-2 py-1 rounded-full border bg-blue-50 border-blue-200 text-blue-800"
    title={n.title}
  >
    {n.label}
  </span>
) : null}
          <div className="text-xs text-gray-600 mt-1">
            {a.recruitName || r?.fullName || r?.email || "Recruit"}
            {a.urgencyRank ? ` • Urgency: ${a.urgencyRank}` : ""}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {a.phone || r?.phone || "—"} • {a.email || r?.email || "—"}
          </div>

          {a.type === "action_item_updated" && a.actionItemText ? (
            <div className="text-xs text-gray-700 mt-2 line-clamp-2">
              <span className="font-semibold">Action Item:</span> {a.actionItemText}
            </div>
          ) : null}
        </button>

        <div className="flex flex-col items-end gap-2">
          <div className="text-xs text-gray-500 whitespace-nowrap">
            {tsToDateTime(a.createdAt) || ""}
          </div>

          {a.isRead !== true && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                markAlertRead(a.id);
              }}
              className="text-xs px-3 py-1 rounded-md bg-black text-white hover:opacity-90"
              title="Clear (mark as read)"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
})
            )}
          </div>
        </div>
 <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-5">
  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
    <div>
    <div className={`text-lg font-extrabold ${headerBlack}`}>Call Priority Queue</div>
<div className="text-xs text-gray-500">
  Highest-priority recruits to contact first, based on Level of Urgency, follow-up timing, and recent activity.
</div>
    </div>

    <div className="text-sm font-semibold">
      Total:{" "}
      <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-700">
        {callPriorityQueue.length}
      </span>
    </div>
  </div>

  {callPriorityQueue.length === 0 ? (
    <div className="mt-4 text-sm text-gray-600">No recruits in the call queue.</div>
  ) : (
    <div className="mt-4 grid gap-2">
{callPriorityQueue.slice(0, 8).map((r) => {
  return (
          <div
            key={r.id}
            onClick={() => openRecruit(r.id)}
            className="rounded-xl border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer transition"
            title="Open recruit"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  {r.fullName || r.email || r.id}
                </div>

               <div className="mt-1 text-xs text-gray-600">
  {callPriorityReason(r)}
</div>

                         </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
             <span
  className={`text-xs font-extrabold px-2 py-1 rounded-full border ${
    urgencyLevelTone(r.levelOfUrgency) === "red"
      ? "bg-red-50 border-red-200 text-red-700"
      : urgencyLevelTone(r.levelOfUrgency) === "orange"
      ? "bg-orange-50 border-orange-200 text-orange-700"
      : urgencyLevelTone(r.levelOfUrgency) === "blue"
      ? "bg-blue-50 border-blue-200 text-blue-700"
      : "bg-gray-50 border-gray-200 text-gray-700"
  }`}
>
  {urgencyLevelPillLabel(r.levelOfUrgency)}
</span>

                        </div>
            </div>
          </div>
        );
      })}
    </div>
  )}
</div>
        {/* Existing grid */}
<RecruitGrid
  mode="agent"
  recruits={recruits}
  currentUser={user}
  currentProfile={profile}
  onOpenRecruit={(r) => openRecruit(r.id)}
/>

      </div>
    </div>
  );
}
