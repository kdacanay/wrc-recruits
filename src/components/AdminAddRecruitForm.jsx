import React, { useState } from "react";
import {
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";

import {
  STATUS_OPTIONS,
  RELATIONSHIP_OPTIONS,
  URGENCY_OPTIONS,
  SOURCE_OPTIONS,
} from "../constants/recruitOptions"; // adjust if needed

const OFFICE_OPTIONS = [
  "Blue Bell",
  "Chadds Ford",
  "Collegeville",
  "Doylestown",
  "Philadelphia",
  "Wayne",
  "West Chester",
  "Wilmington",
];

const POTENTIAL_OPTIONS = [
  "", // allow blank
  "High",
  "Medium",
  "Low",
  "Not sure",
];

function toTimestamp(dateStr) {
  // expects YYYY-MM-DD
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Timestamp.fromDate(d);
}

function cleanStr(v) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function toNumberOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parsePercentToNumberOrNull(v) {
  // stores percent points like your import:
  // "15%" -> 15, "-15%" -> -15, "15" -> 15
  const s = String(v ?? "").trim();
  if (!s) return null;
  const cleaned = s.endsWith("%") ? s.slice(0, -1) : s;
  const n = Number(cleaned.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export default function AdminAddRecruitForm({ onCreated }) {
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    // identity
    firstName: "",
    lastName: "",
    email: "",
    phone: "",

    // option-backed fields
    status: "Identified",
    level: 1, // ✅ ADD THIS (your “Phase” field)
    relationshipRank: "0% or new lead",
    urgencyRank: "Not sure",
    source: "Other",

    // office + follow-ups
    office: "Blue Bell",
    // nextFollowUpDate: "",
    actionItem: "",
    actionItemDueDate: "",
projectedCompanyDollar: "",
    // Courted-style fields
    currentOffice: "",
    potential: "",
    yearsInIndustry: "",
    yearsInOffice: "",
    ltmSalesVolume: "",
    ltmSalesVolumeGrowthPct: "",
  });

  function setField(k, v) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const fn = form.firstName.trim();
    const ln = form.lastName.trim();
    const em = form.email.trim().toLowerCase();
    const ph = form.phone.trim();

    if (!fn && !ln && !em) {
      alert("Please enter at least a name or email.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        // identity
        firstName: fn || null,
        lastName: ln || null,
        fullName: cleanStr(`${fn} ${ln}`.trim()),
        email: em || null,
        phone: ph || null,

        // option-backed fields
       status: form.status || "Identified",
        level: Number.isFinite(Number(form.level)) ? Number(form.level) : 1, // ✅ default to 1
        relationshipRank: form.relationshipRank,
        urgencyRank: form.urgencyRank,
        source: form.source,
projectedCompanyDollar: toNumberOrNull(form.projectedCompanyDollar),
        // office
        office: cleanStr(form.office),

        // follow-up + action item (admin-only edits per your rules)
        // nextFollowUpAt: toTimestamp(form.nextFollowUpDate),
        actionItem: cleanStr(form.actionItem),
        actionItemDueAt: toTimestamp(form.actionItemDueDate),

        // Courted-style fields (match CSV import keys)
        currentOffice: cleanStr(form.currentOffice),
        potential: cleanStr(form.potential),
        yearsInIndustry: toNumberOrNull(form.yearsInIndustry),
        yearsInOffice: toNumberOrNull(form.yearsInOffice),
        ltmSalesVolume: toNumberOrNull(form.ltmSalesVolume),
        ltmSalesVolumeGrowthPct: parsePercentToNumberOrNull(form.ltmSalesVolumeGrowthPct),

        // assignment defaults
        assignedAgentUid: null,
        assignedAgentEmail: null,
        assignedAgentName: null,
        assignedAt: null,
        assignedByUid: null,

        // activity defaults
        lastActivityText: "Recruit created by admin.",
        lastActivityAt: serverTimestamp(),

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, "recruits"), payload);

      alert("Recruit created!");
      onCreated?.(docRef.id);

      // reset (keep option defaults + office)
      setForm((p) => ({
        ...p,
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        nextFollowUpDate: "",
        actionItem: "",
        actionItemDueDate: "",
        currentOffice: "",
        potential: "",
        yearsInIndustry: "",
        yearsInOffice: "",
        ltmSalesVolume: "",
        ltmSalesVolumeGrowthPct: "",
      }));
    } catch (err) {
      console.error("Create recruit error:", err);
      alert(err?.message || "Failed to create recruit. See console.");
    } finally {
      setSaving(false);
    }
  }

  const headerBlack = "text-[var(--color-wrcBlack)]";

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl border border-gray-100 p-5 space-y-5 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <div className={`text-lg font-extrabold ${headerBlack}`}>Add Recruit</div>
        <div className="text-xs text-gray-500">Admin-only</div>
      </div>

      {/* Name + contact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          className="border rounded-md px-3 py-2"
          placeholder="First name"
          value={form.firstName}
          onChange={(e) => setField("firstName", e.target.value)}
        />
        <input
          className="border rounded-md px-3 py-2"
          placeholder="Last name"
          value={form.lastName}
          onChange={(e) => setField("lastName", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          className="border rounded-md px-3 py-2"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setField("email", e.target.value)}
        />
        <input
          className="border rounded-md px-3 py-2"
          placeholder="Phone"
          value={form.phone}
          onChange={(e) => setField("phone", e.target.value)}
        />
      </div>

      {/* Option-backed fields */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Relationship ranking
          </label>
          <select
            className="border rounded-md px-3 py-2 w-full"
            value={form.relationshipRank}
            onChange={(e) => setField("relationshipRank", e.target.value)}
          >
            {RELATIONSHIP_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Urgency likelihood
          </label>
          <select
            className="border rounded-md px-3 py-2 w-full"
            value={form.urgencyRank}
            onChange={(e) => setField("urgencyRank", e.target.value)}
          >
            {URGENCY_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Status</label>
          <select
            className="border rounded-md px-3 py-2 w-full"
            value={form.status}
            onChange={(e) => setField("status", e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-600 mb-1">Source</label>
          <select
            className="border rounded-md px-3 py-2 w-full"
            value={form.source}
            onChange={(e) => setField("source", e.target.value)}
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Office + follow-up */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Office</label>
          <select
            className="border rounded-md px-3 py-2 w-full"
            value={form.office}
            onChange={(e) => setField("office", e.target.value)}
          >
            {OFFICE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        {/* <div>
          <label className="block text-xs text-gray-600 mb-1">Next follow-up</label>
          <input
            type="date"
            className="border rounded-md px-3 py-2 w-full"
            value={form.nextFollowUpDate}
            onChange={(e) => setField("nextFollowUpDate", e.target.value)}
          />
        </div> */}

        <div>
          <label className="block text-xs text-gray-600 mb-1">
            Action item due date
          </label>
          <input
            type="date"
            className="border rounded-md px-3 py-2 w-full"
            value={form.actionItemDueDate}
            onChange={(e) => setField("actionItemDueDate", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-600 mb-1">
          Action Item (agent sees this)
        </label>
        <input
          className="border rounded-md px-3 py-2 w-full"
          value={form.actionItem}
          onChange={(e) => setField("actionItem", e.target.value)}
          placeholder="e.g., Invite for coffee; schedule call; send info packet…"
        />
      </div>

      {/* Courted-style fields */}
      <div>
  <label className="block text-xs text-gray-600 mb-1">Projected Company Dollar (Annual)</label>
  <input
    className="border rounded-md px-3 py-2 w-full"
    value={form.projectedCompanyDollar}
    onChange={(e) => setField("projectedCompanyDollar", e.target.value)}
    placeholder="e.g., 25000"
    inputMode="decimal"
  />
</div>
      <div className="pt-2 border-t border-gray-100">
        <div className={`text-sm font-bold ${headerBlack}`}>Courted-style fields</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Current office</label>
            <input
              className="border rounded-md px-3 py-2 w-full"
              value={form.currentOffice}
              onChange={(e) => setField("currentOffice", e.target.value)}
              placeholder="e.g., KW Blue Bell"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Potential to move</label>
            <select
              className="border rounded-md px-3 py-2 w-full"
              value={form.potential}
              onChange={(e) => setField("potential", e.target.value)}
            >
              {POTENTIAL_OPTIONS.map((o) => (
                <option key={o || "blank"} value={o}>
                  {o || "—"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Years in industry</label>
            <input
              className="border rounded-md px-3 py-2 w-full"
              value={form.yearsInIndustry}
              onChange={(e) => setField("yearsInIndustry", e.target.value)}
              placeholder="e.g., 5"
              inputMode="numeric"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Years in office</label>
            <input
              className="border rounded-md px-3 py-2 w-full"
              value={form.yearsInOffice}
              onChange={(e) => setField("yearsInOffice", e.target.value)}
              placeholder="e.g., 2"
              inputMode="numeric"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">LTM sales volume</label>
            <input
              className="border rounded-md px-3 py-2 w-full"
              value={form.ltmSalesVolume}
              onChange={(e) => setField("ltmSalesVolume", e.target.value)}
              placeholder="e.g., 12000000"
              inputMode="decimal"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">LTM sales % growth</label>
            <input
              className="border rounded-md px-3 py-2 w-full"
              value={form.ltmSalesVolumeGrowthPct}
              onChange={(e) => setField("ltmSalesVolumeGrowthPct", e.target.value)}
              placeholder="e.g., 15 or 15%"
            />
          </div>
        </div>
      </div>

      <button
        disabled={saving}
        className="px-4 py-2 rounded-md bg-black text-white font-semibold disabled:opacity-60"
      >
        {saving ? "Saving..." : "Create Recruit"}
      </button>
    </form>
  );
}
