import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Logs a measurable recruiting action (call, text, appt, hire, etc.)
 * Writes to: recruits/{recruitId}/events/{eventId}
 */
export async function logRecruitEvent(recruitId, payload) {
  if (!recruitId) throw new Error("Missing recruitId");

  const {
    type, // "call" | "text" | "email" | "appointment_set" | "interview" | "signed" | "note"
    text = "",
    visibility = "shared",
    authorUid = null,
    authorName = "",
    authorEmail = null,
    authorRole = "agent",
    meta = {},
  } = payload || {};

  if (!type) throw new Error("Missing event type");

  return addDoc(collection(db, "recruits", recruitId, "events"), {
    type,
    text,
    visibility,
    meta,
    authorUid,
    authorName,
    authorEmail,
    authorRole,
    createdAt: serverTimestamp(),
  });
}
