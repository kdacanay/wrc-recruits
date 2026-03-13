import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";

const APP_BASE_URL = "https://wrc-recruits.web.app";

function fmt(v) {
  return (v ?? "").toString().trim();
}

// Fetch recruits assigned to an agent (by UID)
export async function fetchRecruitsForAgentUid(agentUid) {
  // Preferred: assignedAgentUids array
  const q = query(
    collection(db, "recruits"),
    where("assignedAgentUids", "array-contains", agentUid)
  );

  // If you ONLY use assignedAgentUid (single), swap to:
  // const q = query(collection(db, "recruits"), where("assignedAgentUid", "==", agentUid));

  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function buildRecruitDigestEmail({ agentName, recruits }) {
  const subject = `Your Assigned Recruits (${recruits.length})`;

  const lines = [];
  lines.push(`Hi ${agentName || "there"},`);
  lines.push("");
  lines.push("Here are the recruits currently assigned to you:");
  lines.push("");

  recruits.forEach((r, idx) => {
    const name =
      `${fmt(r.firstName)} ${fmt(r.lastName)}`.trim() || "Unnamed Recruit";
    const phone = fmt(r.phone) || "—";
    const email = fmt(r.email) || "—";
    const urgency = fmt(r.urgencyRank) || "—";
    const link = `${APP_BASE_URL}/agent/recruit/${r.id}`;

    lines.push(`${idx + 1}. ${name}`);
    lines.push(`   Urgency: ${urgency}`);
    lines.push(`   Phone: ${phone}`);
    lines.push(`   Email: ${email}`);
    lines.push(`   Link: ${link}`);
    lines.push("");
  });

  lines.push("Please update notes after any contact attempts.");
  lines.push("");
  lines.push("Thanks,");

  return {
    subject,
    bodyText: lines.join("\n"),
  };
}

export async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}
