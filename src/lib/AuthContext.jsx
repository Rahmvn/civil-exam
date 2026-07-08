import { createContext, useEffect, useMemo, useState } from "react";
import { ensureMyProfile, getProfile } from "./appApi";
import { supabase } from "./supabaseClient";

const AuthContext = createContext(null);

function isProfileComplete(profile) {
  return Boolean(
    profile?.phone_number &&
      profile?.state_code &&
      profile?.service_level &&
      profile?.organization_name &&
      profile?.onboarding_completed_at,
  );
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refreshProfile(userId) {
    if (!userId) {
      setProfile(null);
      return null;
    }

    try {
      let nextProfile = await getProfile(userId);

      if (!nextProfile) {
        nextProfile = await ensureMyProfile();
      }

      setProfile(nextProfile);
      return nextProfile;
    } catch {
      setProfile(null);
      return null;
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      const { data } = await supabase.auth.getSession();

      if (!isMounted) return;

      setSession(data.session);

      if (data.session?.user) {
        await refreshProfile(data.session.user.id);
      } else {
        setProfile(null);
      }

      setLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);

      if (nextSession?.user) {
        await refreshProfile(nextSession.user.id);
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      isAdmin: profile?.role === "admin",
      profileComplete: isProfileComplete(profile),
      refreshProfile,
    }),
    [loading, profile, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
