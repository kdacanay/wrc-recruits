import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot, setDoc, serverTimestamp, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // Firebase Auth user (null = signed out)
  const [profile, setProfile] = useState(null); // users/{uid} doc data
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubProfile = null;

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      console.log("[Auth] onAuthStateChanged:", fbUser?.uid, fbUser?.email);

      // cleanup any previous profile listener
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (!fbUser) {
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setUser(fbUser);

      const userRef = doc(db, "users", fbUser.uid);

      // 1) Ensure profile doc exists
 // 1) Ensure profile doc exists
// 1) Read profile once (no writes from client)
try {
  await getDoc(userRef);
} catch (err) {
  console.error("[Auth] Profile read error:", err);
}



      // 2) Subscribe to profile doc
      unsubProfile = onSnapshot(
        userRef,
        (snap) => {
          setProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null);
          setLoading(false);
        },
        (err) => {
          console.error("[Auth] Profile listener error:", err);
          setProfile(null);
          setLoading(false);
        }
      );
    });

    return () => {
      if (unsubProfile) unsubProfile();
      unsubAuth();
    };
  }, []);

  const value = useMemo(() => ({ user, profile, loading }), [user, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
