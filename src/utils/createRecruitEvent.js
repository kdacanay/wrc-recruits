// src/utils/createRecruitEvent.js
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

export async function createRecruitEvent({
  recruitId,
  recruitName,
  type = "event",
  text = "Alert",
  changes = [],
  actorUid = null,
  actorName = null,
  actorRole = null,
}) {
  if (!recruitId) throw new Error("createRecruitEvent: recruitId required");

  const payload = {
    recruitId,
    recruitName: recruitName || "Recruit",
    type,
    text,
    changes: Array.isArray(changes) ? changes : [],

    actorUid,
    actorName,
    actorRole,

    unreadByAdmins: true,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };

  await addDoc(collection(db, "recruitEvents"), payload);
}
