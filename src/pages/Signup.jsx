import React, { useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useNavigate, Link } from "react-router-dom";
import { OFFICE_OPTIONS } from "../constants/offices";
import { ADMIN_EMAILS } from "../constants/adminEmails";

export default function Signup() {
  const nav = useNavigate();

  const [fullName, setFullName] = useState("");
  const [office, setOffice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    if (!fullName.trim()) return setErr("Please enter your full name.");
    if (!office) return setErr("Please select an office.");
    if (!email.trim()) return setErr("Please enter an email.");
    if (password.length < 6) return setErr("Password must be at least 6 characters.");

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);

      // Optional: sets displayName on Firebase Auth user
      await updateProfile(cred.user, { displayName: fullName.trim() });

      // Store a profile doc for app use
      await setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        fullName: fullName.trim(),
        email: email.trim(),
        office,
        role: "agent", // default; change later to "admin"/"recruiter"/etc.
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      nav("/");
    } catch (e2) {
      console.error(e2);
      setErr(e2?.message || "Signup failed.");
    } finally {
      setLoading(false);
    }
    const emailNorm = email.trim().toLowerCase();
const isAdmin = ADMIN_EMAILS.includes(emailNorm);

const cred = await createUserWithEmailAndPassword(auth, emailNorm, password);

// optional but nice
await updateProfile(cred.user, { displayName: fullName });

await setDoc(
  doc(db, "users", cred.user.uid),
  {
    fullName: fullName.trim(),
    email: emailNorm,
    office: office || null,
    role: isAdmin ? "admin" : "agent",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  },
  { merge: true }
);

  }

  return (
  <div className="min-h-screen flex items-center justify-center bg-wrcGray">
    <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
      <h2 className="text-2xl font-bold text-wrcBlack">
        Create Your Account
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        Already have an account?{" "}
        <Link to="/login" className="text-wrcBlack font-medium underline">
          Log in
        </Link>
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium">Full Name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wrcYellow"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Office</label>
          <select
            value={office}
            onChange={(e) => setOffice(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wrcYellow"
          >
            <option value="">Select Office</option>
            {OFFICE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wrcYellow"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wrcYellow"
          />
        </div>

        {err && (
          <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
            {err}
          </div>
        )}

        <button
          disabled={loading}
          className="w-full bg-wrcBlack text-white py-2 rounded-md font-semibold hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create Account"}
        </button>
      </form>
    </div>
  </div>
);

}
