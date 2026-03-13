import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  getDocs,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth, db, functions } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { httpsCallable } from "firebase/functions";
import {
  fetchRecruitsForAgentUid,
  buildRecruitDigestEmail,
  copyToClipboard,
} from "../utils/recruitEmailDigest";

function tsToText(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

function officeLabel(v) {
  if (!v) return "—";
  // if stored like "BlueBell", add spaces
  return String(v).replace(/([A-Z])/g, " $1").trim();
}

function recruitName(r) {
  return (
    r.fullName ||
    `${r.firstName || ""} ${r.lastName || ""}`.trim() ||
    r.email ||
    "Unnamed recruit"
  );
}

function tsToShortDate(ts) {
  if (!ts) return "—";
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString();
  } catch {
    return "—";
  }
}

export default function AdminUserRoster() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [qText, setQText] = useState("");

  const [emailingUid, setEmailingUid] = useState(null);
  const [deletingUid, setDeletingUid] = useState(null);

  // guard
  useEffect(() => {
    if (profile && profile.role !== "admin") navigate("/agent", { replace: true });
  }, [profile, navigate]);

  useEffect(() => {
    const ref = collection(db, "users");
    // if you don't have createdAt on users, remove orderBy
    const q = query(ref, orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("AdminUserRoster users snapshot:", err)
    );

    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const s = qText.trim().toLowerCase();
    if (!s) return rows;

    return rows.filter((u) => {
      const hay = [u.fullName, u.email, u.office, u.role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(s);
    });
  }, [rows, qText]);

  async function handleLogout() {
    await signOut(auth);
    navigate("/login", { replace: true });
  }

  async function handleCopyAgentRecruitEmail(agent) {
  try {
    // agent.uid should be the user's uid from /users
   const recruits = await fetchRecruitsForAgentUid(agent.id);


    const agentName = agent.fullName || agent.name || agent.email || "Agent";
    const { subject, bodyText } = buildRecruitDigestEmail({ agentName, recruits });

    const fullText = `Subject: ${subject}\n\n${bodyText}`;

    await copyToClipboard(fullText);
    alert("Copied email snippet to clipboard. Paste it into your email.");
  } catch (err) {
    console.error(err);
    alert("Could not build email snippet. Check console.");
  }
}

  async function handleDeleteAuthUser(u) {
    const name = u.fullName || u.email || u.id;

    if (u.id === user?.uid) {
      alert("You can’t delete your own admin account.");
      return;
    }

    const ok = window.confirm(
      `PERMANENTLY delete this user?\n\n${name}\n\nThis will:\n- Delete their Firebase Auth login\n- Delete their profile (users/${u.id})\n- Unassign their recruits\n\nThis cannot be undone.`
    );
    if (!ok) return;

    setDeletingUid(u.id);
    try {
      const fn = httpsCallable(functions, "adminDeleteUser");
      const res = await fn({ uid: u.id, unassignRecruits: true });
      console.log("adminDeleteUser result:", res.data);
      alert(`Deleted user.\nUnassigned recruits: ${res.data?.unassignedCount ?? 0}`);
    } catch (err) {
      console.error("Delete auth user error:", err);
      alert(err?.message || "Could not delete user. Check console.");
    } finally {
      setDeletingUid(null);
    }
  }

async function handleEmailAgentSummary(agent) {
  if (!agent?.id) return;

  const agentEmail = (agent.email || "").trim();
  if (!agentEmail) {
    alert("This user profile has no email saved.");
    return;
  }

  setEmailingUid(agent.id);

  try {
    const ref = collection(db, "recruits");

    // ✅ Keep your current assignment scheme
    const q = query(ref, where("assignedAgentUid", "==", agent.id));
    const snap = await getDocs(q);

    const recruits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // helper: convert urgencyRank to a sortable number
    // Supports numbers or strings like "High/Medium/Low" or "1/2/3"
    function urgencyToNum(v) {
      if (v == null) return -1;

      // numeric urgencyRank
      if (typeof v === "number") return v;

      const s = String(v).trim().toLowerCase();
      if (!s) return -1;

      // common words
      if (s === "high") return 3;
      if (s === "medium") return 2;
      if (s === "low") return 1;

      // strings like "3", "2", "1"
      const n = Number(s);
      if (!Number.isNaN(n)) return n;

      return -1;
    }

    // Sort: urgency desc, then name asc
    recruits.sort((a, b) => {
      const au = urgencyToNum(a.urgencyRank);
      const bu = urgencyToNum(b.urgencyRank);
      if (au !== bu) return bu - au; // DESC
      return recruitName(a).localeCompare(recruitName(b));
    });

    const today = new Date().toLocaleDateString();

    const lines = [];
    lines.push(`Hi ${agent.fullName || "there"},`);
    lines.push("");
    lines.push(`Here are the recruits currently assigned to you as of ${today}:`);
    lines.push("");

    if (recruits.length === 0) {
      lines.push("• No recruits currently assigned.");
    } else {
      for (const r of recruits) {
        const nm = recruitName(r);
        const phone = r.phone || "—";
        const email = r.email || "—";
        const urgency = r.urgencyRank ?? "—";
        const link = `https://wrc-recruits.web.app/agent/recruit/${r.id}`;

        lines.push(`• ${nm}`);
        lines.push(`  Urgency: ${urgency}`);
        lines.push(`  Phone: ${phone}`);
        lines.push(`  Email: ${email}`);
        lines.push(`  Link: ${link}`);
        lines.push(""); // blank line between recruits
      }
    }

    lines.push("— WRC Recruits");

    const subject = `Your assigned recruits (${today})`;
    const body = lines.join("\n");

    const mailto = `mailto:${encodeURIComponent(agentEmail)}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;

    // Mailto length safety (keep your existing behavior)
    if (mailto.length > 1800) {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      alert("Email text was too long for mailto — copied to clipboard instead.");
      return;
    }

    window.location.href = mailto;
  } catch (err) {
    console.error("handleEmailAgentSummary error:", err);
    alert("Could not generate email. Check console.");
  } finally {
    setEmailingUid(null);
  }
}


  const headerBlack = "text-[var(--color-wrcBlack)]";
  const stripeYellow = "bg-[var(--color-wrcYellowUI)]";

  return (
    <div className="min-h-screen bg-[var(--color-wrcGray)]">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl ${stripeYellow} border border-black/10`} />
            <div>
              <div className="text-xs text-gray-500">Weichert Realtors Cornerstone</div>
              <div className={`text-lg font-extrabold ${headerBlack}`}>User Roster</div>
              <div className="text-xs text-gray-500">{filtered.length} user(s)</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className={`text-sm font-semibold ${headerBlack}`}>
                {profile?.fullName || user?.displayName || "Admin"}
              </div>
              <div className="text-xs text-gray-500">{user?.email}</div>
            </div>

            <button
              onClick={() => navigate("/admin")}
              className="px-4 py-2 rounded-md border border-gray-300 bg-white hover:bg-gray-50"
            >
              Back to Admin
            </button>

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

      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <input
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              placeholder="Search name, email, office, role…"
              className="w-full md:w-[420px] px-3 py-2 rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-wrcYellowUI)]"
            />

            <div className="text-xs text-gray-500">
              Tip: offices show as stored in profiles (e.g., BlueBell → Blue Bell)
            </div>
          </div>

          <div className="mt-4 overflow-auto border border-gray-100 rounded-xl">
            <table className="w-full min-w-[980px] border-collapse">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-600">NAME</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-600">EMAIL</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-600">OFFICE</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-600">ROLE</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-600">CREATED</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-600">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900 font-semibold">
                      {u.fullName || "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-blue-700">{u.email || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{officeLabel(u.office)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{u.role || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{tsToText(u.createdAt)}</td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEmailAgentSummary(u);
                          }}
                          disabled={emailingUid === u.id}
                          className="px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold disabled:opacity-60"
                        >
                          {emailingUid === u.id ? "Building…" : "Email recruits"}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAuthUser(u);
                          }}
                          disabled={deletingUid === u.id}
                          className="px-3 py-1.5 rounded-md border border-red-200 text-red-700 bg-white hover:bg-red-50 text-sm font-semibold disabled:opacity-60"
                        >
                          {deletingUid === u.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-sm text-gray-600">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            If “Created” shows as —, your user profile docs probably don’t store{" "}
            <span className="font-mono">createdAt</span> yet (easy fix).
          </div>
        </div>
      </div>
    </div>
  );
}
