import React, { createContext, useContext, useMemo, useState } from 'react';
import type { UserRole } from '../types';

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
  setUserData: (data: UserData | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(false); // No initial loading needed for now

  const role: UserRole = userData ? 'co' : 'onboarding';

  const logout = () => {
    setUserData(null);
  };

  const value = useMemo(
    () => ({ userData, role, loading, setUserData, logout }),
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
