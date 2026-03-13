import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import { useNavigate, Link } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const nav = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      nav("/");
    } catch (e2) {
      console.error(e2);
      setErr(e2?.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-wrcGray">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-wrcYellow border border-black/10" />
          <div>
            <div className="text-sm text-gray-500">Weichert Realtors Cornerstone</div>
            <h2 className="text-2xl font-bold text-wrcBlack">WRC Recruits</h2>
          </div>
        </div>

        <p className="mt-3 text-sm text-gray-600">
          New here?{" "}
          <Link to="/signup" className="text-wrcBlack font-medium underline">
            Create an account
          </Link>
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wrcYellow"
              placeholder="you@weichertcr.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wrcYellow"
              placeholder="Your password"
              autoComplete="current-password"
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
            {loading ? "Logging in..." : "Login"}
          </button>

          <div className="text-xs text-gray-500 text-center pt-2">
            Tip: Use your brokerage email so we can assign the right office & permissions.
          </div>
        </form>
      </div>
    </div>
  );
}
