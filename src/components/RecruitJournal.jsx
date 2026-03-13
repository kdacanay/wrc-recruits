import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  doc,
  updateDoc,
  where,
  deleteDoc
} from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import { logRecruitActivity } from "../utils/logRecruitActivity";

export default function RecruitJournal({ recruitId, recruitName }) {

  const { user, profile } = useAuth();
  const [entries, setEntries] = useState([]);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const authorName = useMemo(() => {
    return profile?.fullName || user?.displayName || user?.email || "User";
  }, [profile?.fullName, user?.displayName, user?.email]);

  const authorRole = profile?.role || "agent";

useEffect(() => {
  if (!recruitId) return;

  const ref = collection(db, "recruits", recruitId, "journal");
  const isAdmin = profile?.role === "admin";

  // Admin: can see everything with one listener
  if (isAdmin) {
    const qAll = query(ref, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qAll,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setEntries(rows);
      },
      (err) => console.error("RecruitJournal snapshot error:", err)
    );
    return () => unsub();
  }

  // Agent: MUST avoid admin-only docs or Firestore will reject the entire query.
  // So we listen to:
  // 1) visibility == "shared"
  // 2) visibility == null  (older notes)
  const qShared = query(ref, where("visibility", "==", "shared"), orderBy("createdAt", "desc"));
  const qLegacy = query(ref, where("visibility", "==", null), orderBy("createdAt", "desc"));

  let map = new Map(); // id -> entry

  function commit() {
    const merged = Array.from(map.values()).sort((a, b) => {
      const am = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const bm = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return bm - am;
    });
    setEntries(merged);
  }

  const unsub1 = onSnapshot(
    qShared,
    (snap) => {
      snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
      commit();
    },
    (err) => console.error("RecruitJournal snapshot(shared) error:", err)
  );

  const unsub2 = onSnapshot(
    qLegacy,
    (snap) => {
      snap.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
      commit();
    },
    (err) => console.error("RecruitJournal snapshot(legacy) error:", err)
  );

  return () => {
    unsub1();
    unsub2();
  };
}, [recruitId, profile?.role]);


  function snippet(s, n = 120) {
    const t = String(s || "").trim().replace(/\s+/g, " ");
    if (!t) return "";
    return t.length > n ? `${t.slice(0, n)}…` : t;
  }

  async function addNote(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;

    if (!user?.uid) {
      alert("You must be signed in to add a note.");
      return;
    }

    setSaving(true);
    try {
      const journalRef = collection(db, "recruits", recruitId, "journal");

      // 1) Create journal entry
      const added = await addDoc(journalRef, {
        text: t,
        visibility: "shared",
        authorUid: user.uid,
        authorName,
        authorEmail: user.email || null,
        authorRole,
        createdAt: serverTimestamp(),
      });

      // 2) Update recruit's latest activity (nice for grid columns)
      const who = authorRole === "admin" ? "Admin" : "Agent";
await updateDoc(doc(db, "recruits", recruitId), {
  lastActivityText: `${who} added journal note: "${snippet(t, 80)}"`,
  lastActivityAt: serverTimestamp(),
  updatedAt: serverTimestamp(),

  // ✅ REQUIRED by your rules for agent updates
  lastUpdatedByUid: user.uid,
  lastUpdatedByName: authorName,
  lastUpdatedByRole: authorRole, // for agents this will be "agent"
  lastUpdatedAt: serverTimestamp(),
});
const rn = (recruitName || "").trim() || "Recruit";

      // 3) Log activity event (for the admin Activity feed)
await logRecruitActivity(recruitId, {
  type: "journal_create",
  message: `${who} added a journal note`,
  unreadByAdmins: true,

  recruitId,
  recruitName: rn,

  actorUid: user.uid,
  actorName: authorName,
  actorEmail: user.email || null,
  actorRole: authorRole,

  journalEntryId: added.id,          // ✅ use the addDoc result
  noteSnippet: snippet(t, 200),      // ✅ use the typed text
});






      setText("");
    } catch (err) {
      console.error("RecruitJournal addNote error:", err);
      alert("Could not save note. Check console.");
    } finally {
      setSaving(false);
    }
  }
async function deleteEntry(entry) {
  const rn = (recruitName || "").trim() || "Recruit";

  const ok = window.confirm("Delete this journal entry?");
  if (!ok) return;

  const who = authorRole === "admin" ? "Admin" : "Agent";

  try {
    // delete
    await deleteDoc(doc(db, "recruits", recruitId, "journal", entry.id));

    // optional: update recruit latest activity
    await updateDoc(doc(db, "recruits", recruitId), {
      lastActivityText: `${who} deleted a journal note`,
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
        // ✅ REQUIRED by your rules for agent updates
  lastUpdatedByUid: user.uid,
  lastUpdatedByName: authorName,
  lastUpdatedByRole: authorRole, // for agents this will be "agent"
  lastUpdatedAt: serverTimestamp(),
    });

    // log activity for admin alerts
   await logRecruitActivity(recruitId, {
  type: "journal_delete",
  message: `${who} deleted a journal note`,
  unreadByAdmins: true,

  recruitId,
  recruitName: rn, // ✅ only once

  actorUid: user?.uid || null,
  actorName: authorName,
  actorEmail: user?.email || null,
  actorRole: authorRole,

  journalEntryId: entry.id,
  noteSnippet: snippet(entry?.text, 200),
});

  } catch (err) {
    console.error("RecruitJournal deleteEntry error:", err);
    alert("Could not delete entry. Check console.");
  }
}


  function formatTs(ts) {
    if (!ts) return "";
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleString();
    } catch {
      return "";
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-5 border-t-4 border-[var(--color-wrcYellowUI)]">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-[var(--color-wrcBlack)]">Journal</h3>
        <div className="text-xs text-gray-500">Shared notes (admin + assigned agent)</div>
      </div>

      <form onSubmit={addNote} className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note..."
          className="flex-1 px-3 py-2 rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-wrcYellowUI)]"
        />
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-md bg-[var(--color-wrcYellowUI)] text-[var(--color-wrcBlack)] font-extrabold border border-black/20 hover:brightness-95 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Add"}
        </button>
      </form>

      <div className="mt-4 space-y-3">
       {entries.length === 0 ? (
  <div className="text-sm text-gray-600">No notes yet.</div>
) : (
  entries.map((e) => {
    const canDelete = profile?.role === "admin" || e.authorUid === user?.uid;

    return (
      <div key={e.id} className="rounded-xl border border-gray-200 p-3">
        <div className="text-sm text-[var(--color-wrcBlack)]">{e.text}</div>

        <div className="mt-1 text-xs text-gray-500 flex items-center justify-between gap-2">
          <span>
            {e.authorName} • {e.authorRole || "agent"}
          </span>

          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap">{formatTs(e.createdAt)}</span>

            {canDelete && (
              <button
                type="button"
                onClick={() => deleteEntry(e)}
                className="text-red-600 hover:text-red-800 font-semibold"
              >
                Delete
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
  );
}
