import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import {
  collection,
  collectionGroup,
  getDocs,
  query,
  where,
  orderBy,
  doc,
  getDoc,
  Timestamp, // ✅ FIX: add Timestamp
} from "firebase/firestore";
import { db } from "../firebase";

// ... keep your helper functions: monthRange, tsToLocalString, etc.
function monthRange(year, month1to12) {
  const start = new Date(year, month1to12 - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month1to12, 1, 0, 0, 0, 0);
  return { start, end };
}
function bumpCount(counts, type) {
  if (!counts) return;

  counts.total = (counts.total || 0) + 1;

  switch (type) {
    case "call":
      counts.call++;
      break;
    case "text":
      counts.text++;
      break;
    case "email":
      counts.email++;
      break;
    case "appointment_set":
      counts.appointment_set++;
      break;
    case "interview":
      counts.interview++;
      break;
    case "signed":
      counts.signed++;
      break;
    case "note":
      counts.note++;
      break;
    default:
      counts.other++;
      break;
  }
}
function tsToLocalString(ts) {
  if (!ts) return "";

  try {
    // Firestore Timestamp
    if (ts.toDate) {
      return ts.toDate().toLocaleString();
    }

    // JS Date
    if (ts instanceof Date) {
      return ts.toLocaleString();
    }

    // Fallback (number/string)
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "" : d.toLocaleString();
  } catch {
    return "";
  }
}
function levelLabel(level) {
  if (level === undefined || level === null || level === "") return "";

  // normalize to string for safety
  const v = String(level).toLowerCase();

  switch (v) {
    case "0":
    case "level0":
    case "zero":
      return "Level 0";
    case "1":
    case "level1":
    case "one":
      return "Level 1";
    case "2":
    case "level2":
    case "two":
      return "Level 2";
    case "3":
    case "level3":
    case "three":
      return "Level 3";
    default:
      return String(level);
  }
}

function recruitDisplayName(r) {
  if (!r) return "";

  // Prefer explicit fullName if you store it
  if (r.fullName) return r.fullName;

  // Fall back to first + last
  const first = r.firstName || "";
  const last = r.lastName || "";
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;

  // Then email
  if (r.email) return r.email;

  // Then phone
  if (r.phone) return r.phone;

  return "Unnamed Recruit";
}


function initCounts() {
  return {
    call: 0,
    text: 0,
    email: 0,
    appointment_set: 0,
    interview: 0,
    signed: 0,
    note: 0,
    other: 0,
    total: 0,
  };
}

export async function exportMonthlyCyaToExcel({
  year,
  month,
  user,
  profile,
  admin = false,
  scope = "self",
  agentUid = null,
}) {
  if (!user?.uid) throw new Error("You must be signed in.");

  const { start, end } = monthRange(year, month);

  // ✅ FIX: use Timestamp bounds (safer with Firestore Timestamp fields)
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);

  const monthLabel = `${year}-${String(month).padStart(2, "0")}`;

  // ---------------------------
  // 1) Load events (permission-safe)
  // ---------------------------
  let events = [];

  const isAdminUser = !!admin; // caller decides; ideally pass (profile?.role==="admin")

  // ✅ AGENT/SELF: avoid collectionGroup (it will fail if any old event is now unreadable)
  if (!isAdminUser || scope === "self") {
    // 1a) find recruits assigned to this user
    // Prefer UID match; also allow email match if you use assignedAgentEmail
    const myEmail = String(user?.email || "").toLowerCase().trim();

    // NOTE: If you ONLY use assignedAgentUid, you can remove the email query.
    const qByUid = query(
      collection(db, "recruits"),
      where("assignedAgentUid", "==", user.uid)
    );

    const qByEmail =
      myEmail
        ? query(collection(db, "recruits"), where("assignedAgentEmail", "==", myEmail))
        : null;

    const [snapUid, snapEmail] = await Promise.all([
      getDocs(qByUid),
      qByEmail ? getDocs(qByEmail) : Promise.resolve({ docs: [] }),
    ]);

    // merge recruits (unique)
    const recruitIds = Array.from(
      new Set([
        ...snapUid.docs.map((d) => d.id),
        ...snapEmail.docs.map((d) => d.id),
      ])
    );

    // 1b) for each recruit, query its /events subcollection for the month
    const perRecruitEvents = await Promise.all(
      recruitIds.map(async (rid) => {
        const evRef = collection(db, "recruits", rid, "events");

        // ✅ FIX: Only request events the agent can ALWAYS read per your rules:
        // - authorUid == current user
        // Otherwise the query can hit admin/private events and PERMISSION_DENIED the whole query.
        const evQ = query(
          evRef,
          where("authorUid", "==", user.uid), // ✅ KEY FIX
          where("createdAt", ">=", startTs),  // ✅ use Timestamp bounds
          where("createdAt", "<", endTs),     // ✅ use Timestamp bounds
          orderBy("createdAt", "asc")
        );

        const evSnap = await getDocs(evQ);
        return evSnap.docs.map((d) => ({
          id: d.id,
          ref: d.ref,
          ...d.data(),
        }));
      })
    );

    events = perRecruitEvents.flat();

    // ✅ FIX: no longer needed because the query already filters to authorUid == user.uid
    // events = events.filter((e) => e.authorUid === user.uid);
  } else {
    // ✅ ADMIN: collectionGroup is fine (admin can read all events)
    let evQ;

    if (scope === "agent") {
      if (!agentUid) throw new Error("Pick an agent for scope='agent'");
      evQ = query(
        collectionGroup(db, "events"),
        where("authorUid", "==", agentUid),
        where("createdAt", ">=", startTs),
        where("createdAt", "<", endTs),
        orderBy("createdAt", "asc")
      );
    } else if (scope === "all") {
      evQ = query(
        collectionGroup(db, "events"),
        where("createdAt", ">=", startTs),
        where("createdAt", "<", endTs),
        orderBy("createdAt", "asc")
      );
    } else {
      // admin self
      evQ = query(
        collectionGroup(db, "events"),
        where("authorUid", "==", user.uid),
        where("createdAt", ">=", startTs),
        where("createdAt", "<", endTs),
        orderBy("createdAt", "asc")
      );
    }

    const evSnap = await getDocs(evQ);
    events = evSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  }

  // ---------------------------
  // 2) Find recruitIds + authorUids and fetch docs
  // ---------------------------
  const recruitIds = Array.from(
    new Set(events.map((e) => e.ref?.parent?.parent?.id).filter(Boolean))
  );

  const authorUids = Array.from(
    new Set(events.map((e) => e.authorUid).filter(Boolean))
  );

  const recruitMap = new Map();
  await Promise.all(
    recruitIds.map(async (rid) => {
      const r = await safeGetRecruit(rid);
      if (r) recruitMap.set(rid, r);
    })
  );

  const userMap = new Map();
  await Promise.all(
    authorUids.map(async (uid) => {
      const u = await safeGetUser(uid);
      if (u) userMap.set(uid, u);
    })
  );

  // ---------------------------
  // 3) SUMMARY COUNTS
  // ---------------------------
  const overall = initCounts();
  for (const e of events) bumpCount(overall, e.type);

  const exporterName =
    profile?.fullName || user?.displayName || user?.email || "User";

  // ---------------------------
  // 4) DETAIL sheet
  // ---------------------------
  const detailRows = events.map((e) => {
    const rid = e.ref?.parent?.parent?.id || "";
    const r = rid ? recruitMap.get(rid) : null;

    const actorProfile = e.authorUid ? userMap.get(e.authorUid) : null;
    const actorName =
      e.authorName ||
      actorProfile?.fullName ||
      actorProfile?.email ||
      e.authorUid ||
      "";

    const actorOffice = actorProfile?.office || actorProfile?.selectedOffice || "";

    return {
      Date: tsToLocalString(e.createdAt),
      Type: e.type || "",
      Agent: actorName,
      AgentOffice: actorOffice,

      RecruitID: rid,
      RecruitName: recruitDisplayName(r),
      RecruitEmail: r?.email || "",
      RecruitPhone: r?.phone || "",
      Level: levelLabel(r?.level || ""),
      Status: r?.status || "",
      CurrentOffice: r?.currentOffice || "",
      Potential: r?.potential || "",
      Note: e.text || "",
    };
  });

  // ---------------------------
  // 5) RECRUITS TOUCHED sheet
  // ---------------------------
  const perRecruit = new Map();
  for (const e of events) {
    const rid = e.ref?.parent?.parent?.id;
    if (!rid) continue;

    if (!perRecruit.has(rid)) {
      perRecruit.set(rid, {
        recruitId: rid,
        counts: initCounts(),
        firstEventAt: e.createdAt || null,
        lastEventAt: e.createdAt || null,
      });
    }

    const agg = perRecruit.get(rid);
    bumpCount(agg.counts, e.type);

    const cur = e.createdAt?.toMillis ? e.createdAt.toMillis() : new Date(e.createdAt).getTime();
    const first = agg.firstEventAt?.toMillis ? agg.firstEventAt.toMillis() : (agg.firstEventAt ? new Date(agg.firstEventAt).getTime() : cur);
    const last = agg.lastEventAt?.toMillis ? agg.lastEventAt.toMillis() : (agg.lastEventAt ? new Date(agg.lastEventAt).getTime() : cur);

    if (cur < first) agg.firstEventAt = e.createdAt;
    if (cur > last) agg.lastEventAt = e.createdAt;
  }

  const recruitsTouchedRows = Array.from(perRecruit.entries()).map(([rid, agg]) => {
    const r = recruitMap.get(rid);

    return {
      RecruitID: rid,
      RecruitName: recruitDisplayName(r),
      RecruitEmail: r?.email || "",
      RecruitPhone: r?.phone || "",
      Level: levelLabel(r?.level || ""),
      Status: r?.status || "",
      CurrentOffice: r?.currentOffice || "",
      Potential: r?.potential || "",

      Calls: agg.counts.call,
      Texts: agg.counts.text,
      Emails: agg.counts.email,
      ApptsSet: agg.counts.appointment_set,
      Interviews: agg.counts.interview,
      SignedHired: agg.counts.signed,
      Notes: agg.counts.note,
      Other: agg.counts.other,
      TotalEvents: agg.counts.total,

      FirstEvent: tsToLocalString(agg.firstEventAt),
      LastEvent: tsToLocalString(agg.lastEventAt),

      AssignedAgent: r?.assignedAgentName || "",
      AssignedAgentEmail: r?.assignedAgentEmail || "",
    };
  });

  // ---------------------------
  // 6) BY AGENT sheet (admin only)
  // ---------------------------
  let byAgentRows = [];
  if (isAdminUser && scope !== "self") {
    const perAgent = new Map();

    for (const e of events) {
      const uid = e.authorUid || "unknown";
      if (!perAgent.has(uid)) perAgent.set(uid, initCounts());
      bumpCount(perAgent.get(uid), e.type);
    }

    byAgentRows = Array.from(perAgent.entries()).map(([uid, counts]) => {
      const u = userMap.get(uid);
      const name = u?.fullName || u?.email || uid;
      const office = u?.office || u?.selectedOffice || "";

      return {
        Agent: name,
        AgentOffice: office,
        Calls: counts.call,
        Texts: counts.text,
        Emails: counts.email,
        ApptsSet: counts.appointment_set,
        Interviews: counts.interview,
        SignedHired: counts.signed,
        Notes: counts.note,
        Other: counts.other,
        TotalEvents: counts.total,
      };
    });

    byAgentRows.sort((a, b) => (b.TotalEvents || 0) - (a.TotalEvents || 0));
  }

  // ---------------------------
  // 7) SUMMARY sheet
  // ---------------------------
  const summaryRows = [
    { Field: "Month", Value: monthLabel },
    { Field: "Exported By", Value: exporterName },
    { Field: "Scope", Value: isAdminUser ? scope : "self" },

    { Field: "—", Value: "—" },
    { Field: "Calls", Value: overall.call },
    { Field: "Texts", Value: overall.text },
    { Field: "Emails", Value: overall.email },
    { Field: "Appointments Set", Value: overall.appointment_set },
    { Field: "Interviews", Value: overall.interview },
    { Field: "Signed/Hired", Value: overall.signed },
    { Field: "Notes", Value: overall.note },
    { Field: "Other", Value: overall.other },

    { Field: "—", Value: "—" },
    { Field: "Total Events", Value: events.length },
    { Field: "Unique Recruits Touched", Value: recruitIds.length },
    { Field: "Unique Agents (events)", Value: authorUids.length },
  ];

  // ---------------------------
  // 8) Write workbook
  // ---------------------------
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), "Detail");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recruitsTouchedRows), "Recruits Touched");

  if (isAdminUser && scope !== "self") {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byAgentRows), "By Agent");
  }

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });

  const suffix =
    !isAdminUser || scope === "self"
      ? exporterName.replace(/\s+/g, "_")
      : scope === "agent"
      ? `agent_${agentUid || "unknown"}`
      : "ALL";

  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `WRC_CYA_${monthLabel}_${suffix}.xlsx`
  );
}
async function safeGetRecruit(recruitId) {
  try {
    const snap = await getDoc(doc(db, "recruits", recruitId));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn("safeGetRecruit blocked or missing:", recruitId, e);
    return null;
  }
}

async function safeGetUser(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.warn("safeGetUser blocked or missing:", uid, e);
    return null;
  }
}
