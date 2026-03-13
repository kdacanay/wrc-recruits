import React, { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";

function tsToText(ts) {
  if (!ts) return "";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "";
  }
}

export default function RecruitActivityFeed({ recruitId, max = 50 }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!recruitId) return;

    const ref = collection(db, "recruits", recruitId, "activity");
    const q = query(ref, orderBy("createdAt", "desc"), limit(max));

    const unsub = onSnapshot(
      q,
      (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("RecruitActivityFeed snapshot:", err)
    );

    return () => unsub();
  }, [recruitId, max]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between">
        <div className="text-lg font-bold text-[var(--color-wrcBlack)]">Activity</div>
        <div className="text-xs text-gray-500">Most recent first</div>
      </div>

      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="text-sm text-gray-600">No activity logged yet.</div>
        ) : (
          items.map((a) => (
            <div key={a.id} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    {a.message || a.type || "Activity"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {(a.actorName || "—") + (a.actorEmail ? ` • ${a.actorEmail}` : "")}
                  </div>
                </div>
                <div className="text-xs text-gray-500">{tsToText(a.createdAt)}</div>
              </div>

              {a.changes ? (
                <div className="mt-2 text-xs text-gray-700 space-y-1">
                  {a.changes.map((c, idx) => (
                    <div key={idx}>
                      <span className="font-semibold">{c.field}</span>:{" "}
                      <span className="text-gray-500">{String(c.from ?? "—")}</span>{" "}
                      → <span className="text-gray-900">{String(c.to ?? "—")}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
