export const URGENCY_LEVEL_OPTIONS = [
  {
    value: 4,
    pillLabel: "Level 4",
    dropdownLabel: "Level 4 — Must be contacted that day",
    shortLabel: "Level 4",
    desc: "Zero tolerance level. This recruit must be contacted that day.",
  },
  {
    value: 3,
    pillLabel: "Level 3",
    dropdownLabel: "Level 3 — Must be contacted from -1 day to +1 day",
    shortLabel: "Level 3",
    desc: "This recruit must be contacted within the window of -1 day to +1 day from the due date.",
  },
  {
    value: 2,
    pillLabel: "Level 2",
    dropdownLabel: "Level 2 — Must be contacted from -1 day to +2 days",
    shortLabel: "Level 2",
    desc: "This recruit must be contacted within the window of -1 day to +2 days from the due date.",
  },
  {
    value: 1,
    pillLabel: "Level 1",
    dropdownLabel: "Level 1 — Can be contacted from -1 day to +3 days",
    shortLabel: "Level 1",
    desc: "This recruit can be contacted within the window of -1 day to +3 days from the due date.",
  },
];

export const SCHEDULING_PRIORITY_HELP = [
  {
    key: "priority-overview",
    title: "What is Scheduling Priority Level?",
    bullets: [
      [
        "Purpose",
        "Scheduling Priority Level determines how strict the timing is for contacting a recruit based on the Action Item Due Date.",
      ],
      [
        "How reminders work",
        "Admin reminder emails are sent one day before the Action Item Due Date.",
      ],
      [
        "How calls work",
        "The priority level determines how much flexibility the agent has around the due date to complete the call.",
      ],
    ],
  },
  {
    key: "level-4",
    title: "Level 4",
    bullets: [
      ["Definition", "Zero tolerance priority."],
      ["Call timing", "The recruit must be contacted on the due date."],
      ["Example", "If the due date is June 10, the call must happen on June 10."],
    ],
  },
  {
    key: "level-3",
    title: "Level 3",
    bullets: [
      ["Call window", "The recruit should be contacted from 1 day before to 1 day after the due date."],
      ["Example", "If the due date is June 10, the call window is June 9–June 11."],
    ],
  },
  {
    key: "level-2",
    title: "Level 2",
    bullets: [
      ["Call window", "The recruit should be contacted from 1 day before to 2 days after the due date."],
      ["Example", "If the due date is June 10, the call window is June 9–June 12."],
    ],
  },
  {
    key: "level-1",
    title: "Level 1",
    bullets: [
      ["Call window", "The recruit can be contacted from 1 day before to 3 days after the due date."],
      ["Example", "If the due date is June 10, the call window is June 9–June 13."],
    ],
  },
];

export function normalizeUrgencyLevel(value) {
  const num = Number(value);

  if (num === 5) return 4;
  if ([1, 2, 3, 4].includes(num)) return num;

  return 1;
}

export function getUrgencyOption(value) {
  const normalized = normalizeUrgencyLevel(value);
  return (
    URGENCY_LEVEL_OPTIONS.find((opt) => opt.value === normalized) ||
    URGENCY_LEVEL_OPTIONS[URGENCY_LEVEL_OPTIONS.length - 1]
  );
}

export function urgencyLevelPillLabel(value) {
  return getUrgencyOption(value).pillLabel;
}

export function urgencyLevelDropdownLabel(value) {
  return getUrgencyOption(value).dropdownLabel;
}

export function urgencyLevelDescription(value) {
  return getUrgencyOption(value).desc;
}

export function urgencyLevelTone(value) {
  const normalized = normalizeUrgencyLevel(value);

  switch (normalized) {
    case 4:
      return "red";
    case 3:
      return "orange";
    case 2:
      return "blue";
    case 1:
    default:
      return "gray";
  }
}

export function urgencyLevelSortValue(value) {
  return normalizeUrgencyLevel(value);
}

export function schedulingPriorityDays(value) {
  const normalized = normalizeUrgencyLevel(value);

  switch (normalized) {
    case 4:
      return 0;
    case 3:
      return 1;
    case 2:
      return 2;
    case 1:
    default:
      return 3;
  }
}

export function schedulingPrioritySubject(value) {
  const normalized = normalizeUrgencyLevel(value);

  switch (normalized) {
    case 4:
      return "Level 4 recruit, must be contacted that day";
    case 3:
      return "Level 3 recruit, must be contacted from -1 day to +1 day";
    case 2:
      return "Level 2 recruit, must be contacted from -1 day to +2 days";
    case 1:
    default:
      return "Level 1 recruit, can be contacted from -1 day to +3 days";
  }
}