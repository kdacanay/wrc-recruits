import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function HomeRedirect() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // If not signed in, go login
    if (user === null) {
      navigate("/login", { replace: true });
      return;
    }

    // If signed in but profile not loaded yet, do nothing (show UI below)
    if (!user || !profile) return;

    navigate(profile.role === "admin" ? "/admin" : "/agent", { replace: true });
  }, [user, profile, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center text-gray-600">
      Loading your dashboard…
    </div>
  );
}
