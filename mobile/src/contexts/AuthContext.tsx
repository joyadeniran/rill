import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { UserRole } from '../types';
import { setAuthToken, setOnUnauthorized } from '../services/api';
import { clearSession, loadSession, saveSession, type StoredSession } from '../services/session';

interface UserData {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
}

interface AuthContextValue {
  userData: UserData | null;
  role: UserRole;
  loading: boolean;
  /** Establish a session: sets the API token, updates state, persists to
   * SecureStore so the officer survives app restarts. */
  signIn: (token: string, data: UserData) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true); // true until session restore completes

  const role: UserRole = userData ? 'co' : 'onboarding';

  const signIn = (token: string, data: UserData) => {
    setAuthToken(token);
    setUserData(data);
    void saveSession({ token, userData: data as StoredSession['userData'] });
  };

  const logout = () => {
    setAuthToken(null);
    setUserData(null);
    void clearSession();
  };

  // Restore a persisted session on cold start (expired tokens are discarded
  // inside loadSession). Also register the 401 hook: if the server rejects our
  // token mid-session, fall back to a clean logged-out state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const session = await loadSession();
      if (!cancelled && session) {
        setAuthToken(session.token);
        setUserData(session.userData);
      }
      if (!cancelled) setLoading(false);
    })();
    setOnUnauthorized(() => {
      setAuthToken(null);
      setUserData(null);
      void clearSession();
    });
    return () => {
      cancelled = true;
      setOnUnauthorized(null);
    };
  }, []);

  const value = useMemo(
    () => ({ userData, role, loading, signIn, logout }),
    [userData, role, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
