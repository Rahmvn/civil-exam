import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureMyProfile, getProfile } from "./appApi";
import { clearReadRequests } from "./requestPolicy";
import { supabase } from "./supabaseClient";

const AuthContext = createContext(null);

async function loadProfile(userId) {
  let nextProfile = await getProfile(userId);

  if (!nextProfile) {
    nextProfile = await ensureMyProfile();
  }

  return nextProfile;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const mountedRef = useRef(true);
  const authReadyRef = useRef(false);
  const currentUserIdRef = useRef(null);
  const profileRequestRef = useRef(0);

  const refreshProfile = useCallback(async (userId) => {
    if (!userId) {
      profileRequestRef.current += 1;
      setProfile(null);
      setProfileLoading(false);
      return null;
    }

    const requestId = profileRequestRef.current + 1;
    profileRequestRef.current = requestId;
    setProfileLoading(true);

    try {
      const nextProfile = await loadProfile(userId);
      if (!mountedRef.current || profileRequestRef.current !== requestId) return nextProfile;
      setProfile(nextProfile);
      return nextProfile;
    } catch {
      if (mountedRef.current && profileRequestRef.current === requestId) setProfile(null);
      return null;
    } finally {
      if (mountedRef.current && profileRequestRef.current === requestId) setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let subscribed = true;

    async function hydrateUserProfile(userId, { blocking }) {
      await refreshProfile(userId);
      if (!subscribed || !mountedRef.current) return;

      if (blocking) {
        authReadyRef.current = true;
        setLoading(false);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!subscribed) return;

      const nextUserId = nextSession?.user?.id ?? null;
      const previousUserId = currentUserIdRef.current;
      const isFirstSession = !authReadyRef.current;
      const userChanged = previousUserId !== nextUserId;

      if (userChanged) clearReadRequests();

      currentUserIdRef.current = nextUserId;
      setSession(nextSession);

      if (!nextUserId) {
        profileRequestRef.current += 1;
        setProfile(null);
        setProfileLoading(false);
        authReadyRef.current = true;
        setLoading(false);
        return;
      }

      if (isFirstSession || userChanged) {
        setLoading(true);
        setProfile(null);
        window.setTimeout(() => {
          if (subscribed) void hydrateUserProfile(nextUserId, { blocking: true });
        }, 0);
        return;
      }

      // Token refreshes update the session silently; they must not blank the app.
      if (event === "USER_UPDATED") {
        window.setTimeout(() => {
          if (subscribed) void hydrateUserProfile(nextUserId, { blocking: false });
        }, 0);
      }
    });

    return () => {
      subscribed = false;
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      profileLoading,
      isAdmin: profile?.role === "admin",
      refreshProfile,
    }),
    [loading, profile, profileLoading, refreshProfile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
