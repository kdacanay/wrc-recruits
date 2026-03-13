// src/utils/phaseLevel.js

export function normalizeLevel(v) {
  // returns "" (unset) or "0"/"1"/"2"/"3"
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (s === "") return "";
  if (["0", "1", "2", "3"].includes(s)) return s;
  return "";
}

export function levelToPhase(v) {
  const s = normalizeLevel(v);
  if (s === "") return "—";
  if (s === "0") return "DNC";
  if (s === "1") return "Engagement Phase";
  if (s === "2") return "Relationship Building Phase";
  if (s === "3") return "Sphere of Influence";
  return "—";
}

export const LEVEL_DROPDOWN_OPTIONS = [
  { value: "", label: "— Select phase —" },
  { value: "0", label: "DNC" },
  { value: "1", label: "Engagement Phase" },
  { value: "2", label: "Relationship Building Phase" },
  { value: "3", label: "Sphere of Influence" },
];

export const PHASE_HELP = [
  {
    key: "phase-overview",
    title: "What is Phase?",
    bullets: [
      [
        "Purpose",
        "Phase shows where the recruit stands in the recruiting relationship.",
      ],
      [
        "Use it for",
        "Organizing the recruit’s overall stage, from early contact through deeper long-term relationship.",
      ],
   [
  "Different from Scheduling Priority Level",
  "Phase is the relationship stage. Scheduling Priority Level is how quickly the recruit should be contacted.",
],
    ],
  },
  {
    key: "dnc",
    title: "DNC",
    bullets: [
      ["Definition", "Do not contact."],
      [
        "Use when",
        "They requested no contact, are the wrong person, are not a fit, or should be permanently excluded.",
      ],
      [
        "Note",
        "This should usually be used intentionally, since it removes them from normal recruiting follow-up.",
      ],
    ],
  },
  {
    key: "engagement",
    title: "Engagement Phase",
    bullets: [
      [
        "Definition",
        "Early-stage recruits where you are establishing contact and determining whether there is openness.",
      ],
      [
        "What you do",
        "First outreach attempts, introductions, discovery questions, and early relationship building.",
      ],
      [
        "Examples",
        "New contact, not contacted yet, light replies, no face-to-face, unconnected.",
      ],
      [
        "Move up when",
        "They begin responding consistently and the relationship starts developing.",
      ],
    ],
  },
  {
    key: "relationship",
    title: "Relationship Building Phase",
    bullets: [
      [
        "Definition",
        "Recruits where the relationship is actively being built and nurtured over time.",
      ],
      [
        "What you do",
        "Stay in touch, provide value, learn timing and motivation, and continue meaningful follow-up.",
      ],
      [
        "Examples",
        "They reply, stay in contact, and are open to ongoing communication, but are not yet in your deeper sphere.",
      ],
      [
        "Move up when",
        "They become a stronger long-term relationship and belong in your recruiting sphere.",
      ],
    ],
  },
  {
    key: "sphere",
    title: "Sphere of Influence",
    bullets: [
      [
        "Definition",
        "Long-term relationship contacts with stronger recruiting potential who belong in your deeper recruiting network.",
      ],
      [
        "What you do",
        "Consistent relationship management through check-ins, invitations, updates, events, and periodic calls or texts.",
      ],
      [
        "Examples",
        "Strong rapport, strong likelihood to move, or someone worth keeping warm over the long term.",
      ],
    [
  "Note",
  "This is still different from Scheduling Priority Level. A recruit can be in Sphere of Influence without always being the top person to call today.",
],
    ],
  },
];