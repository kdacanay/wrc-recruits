// src/utils/logRecruitActivity.js
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

export async function logRecruitActivity(recruitId, activity = {}) {
  if (!recruitId) throw new Error("Missing recruitId");

  const {
    type,
    message,
    recruitName,
    actorUid,
    actorName,
    actorEmail,
    actorRole,
    changes = [],
    unreadByAdmins = true,
    journalEntryId = null,
    noteSnippet = null,
  } = activity;

  if (!type) throw new Error("Missing activity.type");
  if (!actorUid) throw new Error("Missing activity.actorUid");

  const colRef = collection(db, "recruits", recruitId, "activity");

  return addDoc(colRef, {
    recruitId,
    recruitName: (recruitName || "").trim() || "Recruit",
    type,
    message: message || "",
    actorUid,
    actorName: actorName || "",
    actorEmail: actorEmail || null,
    actorRole: actorRole || "agent",
    changes,
    unreadByAdmins: unreadByAdmins === true,
    journalEntryId,
    noteSnippet,
    createdAt: serverTimestamp(),
  });
}
