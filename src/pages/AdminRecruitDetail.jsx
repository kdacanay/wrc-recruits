import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import RecruitDetailView from "../components/RecruitDetailView";

export default function AdminRecruitDetail({ modal }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [agents, setAgents] = useState([]);

  // ✅ animation state
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // Load agents for assignment card (admin only)
  useEffect(() => {
    const ref = collection(db, "users");
    const q = query(ref, where("role", "in", ["manager", "agent"]));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) =>
          String(a.fullName || a.email || "").localeCompare(
            String(b.fullName || b.email || "")
          )
        );
        setAgents(rows);
      },
      (err) => console.error("AdminRecruitDetail users listener:", err)
    );

    return () => unsub();
  }, []);

  // Guard (non-admins -> agent)
  useEffect(() => {
    if (profile && profile.role !== "admin") navigate("/agent", { replace: true });
  }, [profile, navigate]);

  // ✅ Close helper (plays slide-out, then navigates back)
  const close = () => {
    if (!modal) {
      navigate("/admin");
      return;
    }
    if (isClosing) return;

    setIsClosing(true);
    setIsOpen(false);

    // let the CSS transition finish before unmounting
    setTimeout(() => {
      navigate(-1);
    }, 220);
  };

  // ✅ Open animation on mount (modal only)
  useEffect(() => {
    if (!modal) return;

    // lock background scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // slide in after first paint
    requestAnimationFrame(() => setIsOpen(true));

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [modal]);

  // ✅ Back behavior (used by RecruitDetailView)
  const handleBack = () => {
    if (modal) close();
    else navigate("/admin");
  };

  // ✅ Overlay (modal) wrapper
  if (modal) {
    return (
      <div className="fixed inset-0 z-50">
        {/* Backdrop */}
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
            isOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={close}
        />

        {/* Drawer */}
        <div
          className={`absolute right-0 top-0 h-full w-full max-w-6xl bg-white shadow-2xl overflow-y-auto
                      transform transition-transform duration-200 ease-out
                      ${isOpen ? "translate-x-0" : "translate-x-full"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 z-10 bg-white border-b border-gray-200 p-3 flex items-center justify-between">
            <div className="text-sm font-extrabold text-[var(--color-wrcBlack)]">
              Recruit Detail
            </div>

            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 rounded-md border border-gray-300 bg-white font-semibold hover:bg-gray-50"
            >
              Close
            </button>
          </div>

          <RecruitDetailView recruitId={id} mode="admin" agents={agents} onBack={handleBack} />
        </div>
      </div>
    );
  }

  // ✅ Full page fallback (direct link / refresh)
  return (
    <RecruitDetailView
      recruitId={id}
      mode="admin"
      agents={agents}
      onBack={handleBack}
    />
  );
}