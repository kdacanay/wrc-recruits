// src/utils/notifyAssignedAgent.js

function encodeMailto(str = "") {
  return encodeURIComponent(str);
}

function buildRecruitLink(appUrl, recruitId, mode = "agent", query = "") {
  const base = String(appUrl || "").replace(/\/$/, "");
  const path =
    mode === "admin" ? `/admin/recruit/${recruitId}` : `/agent/recruit/${recruitId}`;

  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return `${base}${path}${q}`;
}

function outlookWebComposeUrl({ to, subject, body }) {
  return `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(
    to || ""
  )}&subject=${encodeMailto(subject)}&body=${encodeMailto(body)}`;
}

function mailtoUrl({ to, subject, body }) {
  return `mailto:${encodeURIComponent(to || "")}?subject=${encodeMailto(
    subject
  )}&body=${encodeMailto(body)}`;
}

function normalizePriorityLevel(level) {
  const n = Number(level);

  if (n === 5) return 4; // old Inner Sphere -> new Level 4
  if ([1, 2, 3, 4].includes(n)) return n;

  return 1;
}

function schedulingPrioritySubject(level) {
  const n = normalizePriorityLevel(level);

  switch (n) {
    case 4:
      return "Level 4 recruit, Priority, must be contacted that day";
    case 3:
      return "Level 3 recruit, must be contacted within + or - 1 day";
    case 2:
      return "Level 2 recruit, must be contacted within + or - 2 days";
    case 1:
    default:
      return "Level 1 recruit, can be contacted within + or - 5 days";
  }
}

function schedulingPriorityLabel(level) {
  const n = normalizePriorityLevel(level);
  return `Level ${n}`;
}

function urgencyEmailLabel(level) {
  const n = Number(level);

  if (n === 4) return "🚨 LEVEL 4 — MUST BE CONTACTED TODAY";
  if (n === 3) return "⚠️ LEVEL 3 — CONTACT ±1 DAY";
  if (n === 2) return "📞 LEVEL 2 — CONTACT ±2 DAYS";
  if (n === 1) return "📅 LEVEL 1 — CONTACT ±3 DAYS";

  return "—";
}
export function buildAssignedAgentEmail({
  agentEmail,
  recruitName,
  recruitId,
  recruitPhone,
  recruitEmail,
  urgencyLevel,
  actionItemText,
  actionItemDueText,
  appUrl,
}) {
  const subject = schedulingPrioritySubject(urgencyLevel);
  const recruitLink = buildRecruitLink(appUrl, recruitId, "agent");

const bodyLines = [
  `RECRUIT REMINDER`,
  `================================`,
  ``,
  `Recruit: ${recruitName || "—"}`,
  `Phone: ${recruitPhone || "—"}`,
  `Email: ${recruitEmail || "—"}`,
  ``,
  `⚠️  SCHEDULING PRIORITY LEVEL`,
  `--------------------------------`,
  `>>> ${urgencyEmailLabel(urgencyLevel)} <<<`,
  ``,
  actionItemText ? `Action Item: ${actionItemText}` : null,
  actionItemDueText ? `Due Date: ${actionItemDueText}` : null,
  ``,
  `Open Recruit:`,
  recruitLink,
];

  const body = bodyLines.filter(Boolean).join("\n");

  return {
    to: agentEmail,
    subject,
    body,
  };
}

export async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

export function openMailDraft({ to, subject, body }) {
  window.location.href = mailtoUrl({ to, subject, body });
}