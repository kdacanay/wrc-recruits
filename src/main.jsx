import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Home from "./pages/Home";
import HomeRedirect from "./pages/HomeRedirect";

import AdminRecruitDetail from "./pages/AdminRecruitDetail";
import AgentRecruitDetail from "./pages/AgentRecruitDetail";
import AdminDashboard from "./pages/AdminDashboard";
import AgentDashboard from "./pages/AgentDashboard";
import AdminUserRoster from "./pages/AdminUserRoster";

import "./index.css";

/**
 * AppRoutes supports "background location" routing so the dashboard (list)
 * stays mounted while recruit detail renders as an overlay route.
 */
function AppRoutes() {
  const location = useLocation();
  const state = location.state;

  // If we came from a list page with backgroundLocation, keep that list route as the "real" location.
  const backgroundLocation = state?.backgroundLocation;

  return (
    <>
      {/* Main routes render using backgroundLocation (when present) */}
      <Routes location={backgroundLocation || location}>
        {/* Public */}
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Redirect landing */}
        <Route path="/" element={<HomeRedirect />} />

        {/* Protected home page */}
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />

        {/* Dashboards */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/agent"
          element={
            <ProtectedRoute>
              <AgentDashboard />
            </ProtectedRoute>
          }
        />

        {/* Admin roster */}
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute>
              <AdminUserRoster />
            </ProtectedRoute>
          }
        />

        {/* Direct-link support:
            If someone loads /admin/recruit/:id directly (no backgroundLocation),
            this route will render normally (full page).
        */}
        <Route
          path="/admin/recruit/:id"
          element={
            <ProtectedRoute>
              <AdminRecruitDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/agent/recruit/:id"
          element={
            <ProtectedRoute>
              <AgentRecruitDetail />
            </ProtectedRoute>
          }
        />

        {/* Optional: add a catch-all if you want */}
        {/* <Route path="*" element={<HomeRedirect />} /> */}
      </Routes>

      {/* Overlay routes: only render when we have a backgroundLocation.
          This is the "modal/side panel" layer that sits on top of the list.
      */}
      {backgroundLocation && (
        <Routes>
          <Route
            path="/admin/recruit/:id"
            element={
              <ProtectedRoute>
                <AdminRecruitDetail modal />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agent/recruit/:id"
            element={
              <ProtectedRoute>
                <AgentRecruitDetail modal />
              </ProtectedRoute>
            }
          />
        </Routes>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);