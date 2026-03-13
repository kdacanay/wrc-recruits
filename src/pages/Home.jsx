import React, { useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import AdminDashboard from "./AdminDashboard";
import AgentDashboard from "./AgentDashboard";
import { ADMIN_EMAILS } from "../constants/adminEmails";
import { db } from "../firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export default function Home() {
  const { loading, user, profile } = useAuth();

  useEffect(() => {
    async function bootstrapAdmin() {
      if (!user?.uid || !user?.email) return;

      const emailNorm = user.email.trim().toLowerCase();
      const shouldBeAdmin = ADMIN_EMAILS.includes(emailNorm);

      // If you're on the admin list but profile isn't admin yet, fix it.
      if (shouldBeAdmin && profile?.role !== "admin") {
        await setDoc(
          doc(db, "users", user.uid),
          {
            email: emailNorm,
            role: "admin",
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    bootstrapAdmin().catch((e) => console.error("bootstrapAdmin error:", e));
  }, [user?.uid, user?.email, profile?.role]);

  if (loading) return <div className="p-6">Loading...</div>;

  const role = profile?.role || "agent";
  return role === "admin" ? <AdminDashboard /> : <AgentDashboard />;
}
