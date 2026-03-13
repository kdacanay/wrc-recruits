/**
 * Firebase Functions (WRC Recruits)
 * - bulkDeleteRecruits (admin-only)
 * - deleteSelectedRecruits (admin-only)
 * - adminDeleteUser (admin-only)
 * - onRecruitJournalCreated (agent journal -> admin alert)
 * - onRecruitUpdated (agent updates fields -> admin alert; includes STATUS change)
 *
 * IMPORTANT:
 * - Uses v2 only (https + firestore)
 * - Only ONE admin.initializeApp()
 */

const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");

setGlobalOptions({ maxInstances: 10, region: "us-central1" });

admin.initializeApp();
const db = admin.firestore();

/* -------------------------
   Helpers
------------------------- */

async function getUserProfile(uid) {
  if (!uid) return null;
  const snap = await db.doc(`users/${uid}`).get();
  return snap.exists ? snap.data() : null;
}

function displayNameFromProfile(profile, fallbackEmail) {
  return (
    profile?.fullName ||
    profile?.displayName ||
    profile?.email ||
    fallbackEmail ||
    "User"
  );
}

async function getRecruitName(recruitId, fallback = null) {
  try {
    if (!recruitId) return fallback;

    const snap = await db.doc(`recruits/${recruitId}`).get();
    if (!snap.exists) return fallback;

    const r = snap.data() || {};
    return (
      r.fullName ||
      `${r.firstName || ""} ${r.lastName || ""}`.trim() ||
      r.email ||
      fallback
    );
  } catch (e) {
    return fallback;
  }
}

async function writeRecruitEvent({
  recruitId,
  recruitName = null,
  eventType,
  message,
  actorUid,
  actorName,
  actorRole,
  field = null,
  before = null,
  after = null,
  meta = {},
}) {
  await db.collection("recruitEvents").add({
    recruitId,
    recruitName,
    eventType,
    field,
    before,
    after,
    message,
    actorUid,
    actorName,
    actorRole,
    unreadByAdmins: actorRole === "agent",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...meta,
  });
}

async function assertAdmin(requestAuth) {
  if (!requestAuth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }
  const snap = await db.doc(`users/${requestAuth.uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "Profile not found.");
  if (snap.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
}

async function assertNotLastAdmin(targetUid) {
  const adminsSnap = await db.collection("users").where("role", "==", "admin").get();
  if (adminsSnap.size > 1) return;

  const targetSnap = await db.doc(`users/${targetUid}`).get();
  const targetRole = targetSnap.exists ? targetSnap.data()?.role : null;
  if (targetRole === "admin") {
    throw new HttpsError("failed-precondition", "You cannot delete the last admin.");
  }
}

async function unassignRecruitsFromUser(uid) {
  const recruitsSnap = await db.collection("recruits").where("assignedAgentUid", "==", uid).get();
  if (recruitsSnap.empty) return 0;

  let updated = 0;
  let batch = db.batch();
  let opCount = 0;

  for (const docSnap of recruitsSnap.docs) {
    batch.update(docSnap.ref, {
      assignedAgentUid: null,
      assignedAgentEmail: null,
      assignedAgentName: null,
      assignedAt: null,
      lastActivityText: "System unassigned recruit (agent account deleted).",
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    updated++;
    opCount++;

    if (opCount >= 450) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) await batch.commit();
  return updated;
}

/* -------------------------
   Callable Functions (v2)
------------------------- */

// Admin-only bulk delete of ALL recruits
exports.bulkDeleteRecruits = onCall(async (request) => {
  await assertAdmin(request.auth);

  const recruitsSnap = await db.collection("recruits").get();
  if (recruitsSnap.empty) return { deleted: 0 };

  let deleted = 0;

  if (typeof db.recursiveDelete === "function") {
    for (const docSnap of recruitsSnap.docs) {
      await db.recursiveDelete(docSnap.ref);
      deleted++;
    }
    return { deleted, mode: "recursiveDelete" };
  }

  let batch = db.batch();
  let opCount = 0;

  for (const docSnap of recruitsSnap.docs) {
    batch.delete(docSnap.ref);
    deleted++;
    opCount++;

    if (opCount >= 450) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) await batch.commit();
  return { deleted, mode: "docsOnly" };
});

// Admin-only delete by selected IDs
exports.deleteSelectedRecruits = onCall(async (request) => {
  await assertAdmin(request.auth);

  const ids = request.data?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new HttpsError("invalid-argument", "Missing ids[]");
  }

  // Safety limit
  if (ids.length > 250) {
    throw new HttpsError("invalid-argument", "Too many ids (max 250).");
  }

  let deleted = 0;

  if (typeof db.recursiveDelete === "function") {
    for (const id of ids) {
      if (!id) continue;
      await db.recursiveDelete(db.doc(`recruits/${id}`));
      deleted++;
    }
    return { ok: true, deleted, mode: "recursiveDelete" };
  }

  let batch = db.batch();
  let opCount = 0;

  for (const id of ids) {
    if (!id) continue;
    batch.delete(db.doc(`recruits/${id}`));
    deleted++;
    opCount++;

    if (opCount >= 450) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) await batch.commit();

  return { ok: true, deleted, mode: "docsOnly" };
});

// Admin-only delete user
exports.adminDeleteUser = onCall(async (request) => {
  await assertAdmin(request.auth);

  const targetUid = request.data?.uid;
  const alsoUnassignRecruits = request.data?.unassignRecruits !== false; // default true

  if (!targetUid) throw new HttpsError("invalid-argument", "Missing uid.");
  if (targetUid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You cannot delete yourself.");
  }

  await assertNotLastAdmin(targetUid);

  let unassignedCount = 0;
  if (alsoUnassignRecruits) {
    unassignedCount = await unassignRecruitsFromUser(targetUid);
  }

  try {
    await admin.auth().deleteUser(targetUid);
  } catch (e) {
    if (e?.code !== "auth/user-not-found") {
      throw new HttpsError("internal", `Auth delete failed: ${e.message || e}`);
    }
  }

  await db.doc(`users/${targetUid}`).delete();
  return { ok: true, uid: targetUid, unassignedCount };
});

/* -------------------------
   Firestore Triggers (v2)
------------------------- */

/**
 * Journal entry created -> alert admins (only when an AGENT writes it)
 */
exports.onRecruitJournalCreated = onDocumentCreated(
  { document: "recruits/{recruitId}/journal/{entryId}" },
  async (event) => {
    const { recruitId, entryId } = event.params;
    const data = event.data?.data() || {};

    const actorUid = data.authorUid || data.actorUid || data.userId || null;
    if (!actorUid) return;

    // Prefer stored authorRole/authorName (set by your client),
    // but fall back to profile lookup.
    let actorRole = data.authorRole || null;
    let actorName = data.authorName || null;

    if (!actorRole || !actorName) {
      const profile = await getUserProfile(actorUid);
      actorRole = actorRole || profile?.role || "agent";
      actorName = actorName || displayNameFromProfile(profile, null);
    }

    // Only alert admins for agent activity
    if (actorRole !== "agent") return;

    const preview =
      typeof data.text === "string" && data.text.trim()
        ? ` “${data.text.trim().slice(0, 80)}${data.text.trim().length > 80 ? "…" : ""}”`
        : "";

    const recruitName = await getRecruitName(recruitId, recruitId);

    await writeRecruitEvent({
      recruitId,
      recruitName,
      eventType: "journal_added",
      message: `Journal entry added for ${recruitName} by ${actorName}.${preview}`,
      actorUid,
      actorName,
      actorRole,
      meta: { entryId },
    });
  }
);

/**
 * Recruit updated -> alert admins on agent-driven changes
 * Watches: relationshipRank, urgencyRank, status
 */
exports.onRecruitUpdated = onDocumentUpdated(
  { document: "recruits/{recruitId}" },
  async (event) => {
    const { recruitId } = event.params;

    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};

    // We rely on your client writing these
    const actorUid = after.lastUpdatedByUid || null;
    const actorRole = after.lastUpdatedByRole || null;

    // Skip if we can't identify actor (prevents noise)
    if (!actorUid || !actorRole) return;

    // Only alert on agent-driven updates
    if (actorRole !== "agent") return;

    let actorName = after.lastUpdatedByName || null;
    if (!actorName) {
      const profile = await getUserProfile(actorUid);
      actorName = displayNameFromProfile(profile, null);
    }

    const recruitName =
      after.fullName ||
      `${after.firstName || ""} ${after.lastName || ""}`.trim() ||
      after.email ||
      recruitId;

    const watchFields = ["relationshipRank", "urgencyRank", "status"];

    for (const field of watchFields) {
      const b = before[field] ?? null;
      const a = after[field] ?? null;
      if (b === a) continue;

      await writeRecruitEvent({
        recruitId,
        recruitName,
        eventType: "field_changed",
        field,
        before: b,
        after: a,
        message: `${actorName} updated ${field} for ${recruitName}: ${b ?? "—"} → ${a ?? "—"}`,
        actorUid,
        actorName,
        actorRole,
      });
    }
  }
);

function changed(before, after, field) {
  const b = before?.[field] ?? null;
  const a = after?.[field] ?? null;

  // timestamps
  const bMs = b?.toMillis ? b.toMillis() : b;
  const aMs = a?.toMillis ? a.toMillis() : a;

  return JSON.stringify(bMs) !== JSON.stringify(aMs);
}

exports.onRecruitUpdatedNotifyAgent = onDocumentUpdated(
  { document: "recruits/{recruitId}" },
  async (event) => {
    const { recruitId } = event.params;
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};

    // Only admin-driven updates
    const actorRole = String(after.lastUpdatedByRole || "").trim();
    if (actorRole !== "admin") return;

    // Must have an assigned agent
    const agentUid = after.assignedAgentUid || null;
    if (!agentUid) return;

    // Detect key changes
    const actionItemChanged =
      changed(before, after, "actionItemText") ||
      changed(before, after, "actionItemDueAt");

    const importantFields = [];
    if (changed(before, after, "status")) importantFields.push("status");
    if (changed(before, after, "urgencyRank")) importantFields.push("urgencyRank");
    if (changed(before, after, "relationshipRank")) importantFields.push("relationshipRank");
    if (actionItemChanged) {
      importantFields.push("actionItemText", "actionItemDueAt");
    }

    // If nothing we care about changed, bail
    if (importantFields.length === 0) return;

    const recruitName =
      after.fullName ||
      `${after.firstName || ""} ${after.lastName || ""}`.trim() ||
      after.email ||
      recruitId;

    const type = actionItemChanged ? "action_item_updated" : "admin_updated";

    const payload = {
      agentUid,
      recruitId,
      recruitName,
      type,
      fields: importantFields,
      message: actionItemChanged
        ? `Action Item updated for ${recruitName}`
        : `Recruit updated by admin: ${recruitName}`,
      actionItemText: after.actionItemText || null,
      actionItemDueAt: after.actionItemDueAt || null,
      urgencyRank: after.urgencyRank || null,
      phone: after.phone || null,
      email: after.email || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isRead: false,
    };

    // Use event.id so retries don't duplicate
    const notifId = event.id || `${agentUid}_${recruitId}_${Date.now()}`;
    await db.collection("agentNotifications").doc(notifId).set(payload);
  }
);
