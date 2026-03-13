// constants/recruitOptions.js

export const STATUS_OPTIONS = [
  "Identified",
  "Contacted",
  "Connected",
  "Meeting scheduled",
  "Meeting held",
  "Negotiating",
  "Contract out",
  "Recruited",
  "Not qualified",
  "Not interested",
  "Interviewing",
  "Short-term management",
  "Long-term management",
];

export const RELATIONSHIP_OPTIONS = [
  "0% or untouched",
  "18% 1st touch",
  "34% 2nd touch",
  "56% 3rd touch",
  "78% 4th touch",
];

// Keeping this only for any older parts of the app that still reference it.
// Your main urgency / priority dropdown is now controlled by utils/urgencyLevel.js.
export const URGENCY_OPTIONS = [
  "Very Low Likelihood",
  "Low Likelihood",
  "Not Sure",
  "Likely",
  "Very Likely",
];

export const SOURCE_OPTIONS = [
  "Courted",
  "Other",
  "Referral",
  "Event",
  "Social",
  "Inbound",
  "Outbound",
  "Manager list",
];