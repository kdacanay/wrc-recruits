import React, { useEffect, useState } from "react"; // ✅ FIX: add useState
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import RecruitDetailView from "../components/RecruitDetailView";

export default function AgentRecruitDetail({ modal }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  // ✅ FIX: animation state
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // optional: guard
  useEffect(() => {
    if (profile && profile.role === "admin") navigate("/admin", { replace: true });
  }, [profile, navigate]);

  // ✅ FIX: close helper (slide out first, then navigate)
  const close = () => {
    if (!modal) {
      navigate("/agent");
      return;
    }
    if (isClosing) return;

    setIsClosing(true);
    setIsOpen(false);

    setTimeout(() => {
      navigate(-1); // ✅ unmount after animation finishes
    }, 220);
  };

  // ✅ FIX: slide in after mount + lock background scroll
  useEffect(() => {
    if (!modal) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => setIsOpen(true));

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [modal]);

  // ✅ FIX: back handler should call close (not navigate(-1) immediately)
  const handleBack = () => {
    if (modal) close();
    else navigate("/agent");
  };

  // ✅ Overlay (modal) wrapper
  if (modal) {
    return (
      <div className="fixed inset-0 z-50">
        {/* ✅ FIX: animated backdrop */}
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
            isOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={close}
        />

        {/* ✅ FIX: animated drawer */}
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
              onClick={close} // ✅ FIX: call close (animated)
              className="px-3 py-1.5 rounded-md border border-gray-300 bg-white font-semibold hover:bg-gray-50"
            >
              Close
            </button>
          </div>

          <RecruitDetailView recruitId={id} mode="agent" onBack={handleBack} />
        </div>
      </div>
    );
  }

  // ✅ Full page (direct link / refresh)
  return <RecruitDetailView recruitId={id} mode="agent" onBack={handleBack} />;
}