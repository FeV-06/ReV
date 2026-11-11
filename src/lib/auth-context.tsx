'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type UserRole = 'admin' | 'developer' | 'departing';
export type EvalMode = 'demo' | 'live';

export interface UserProfile {
  name: string;
  role: UserRole;
  title: string;
  avatar: string;
  email: string;
}

const SUPERUSER_PROFILES: Record<UserRole, UserProfile> = {
  admin: {
    name: 'Jordan Rivera',
    role: 'admin',
    title: 'Superuser / Tech Lead',
    avatar: '👑',
    email: 'jordan.rivera@team.internal',
  },
  departing: { name: 'Departing teammate', role: 'departing', title: 'Departure interview', avatar: '✎', email: '' },
  developer: {
    name: 'Alex Vance',
    role: 'developer',
    title: 'Successor / Onboarding Dev',
    avatar: '👤',
    email: 'alex.vance@team.internal',
  },
};

interface AuthContextType {
  user: UserProfile | null;
  role: UserRole | null;
  evalMode: EvalMode;
  setEvalMode: (mode: EvalMode) => void;
  tourActive: boolean;
  setTourActive: (active: boolean) => void;
  tourStep: number;
  setTourStep: (step: number | ((prev: number) => number)) => void;
  loginAsSuperuser: (role: UserRole, mode?: EvalMode) => void;
  loginWithCredentials: (name: string, email: string, role: UserRole) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [evalMode, setEvalModeState] = useState<EvalMode>('demo');
  const [tourActive, setTourActive] = useState<boolean>(true);
  const [tourStep, setTourStep] = useState<number>(1);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem('rev_eval_mode') as EvalMode | null;
      if (savedMode === 'demo' || savedMode === 'live') {
        setEvalModeState(savedMode);
        setTourActive(savedMode === 'demo');
      }

      // Check query parameter for automated testing / fast dev link
      const params = new URLSearchParams(window.location.search);
      const modeParam = params.get('mode');
      if (modeParam === 'live' || modeParam === 'demo') {
        setEvalModeState(modeParam);
        setTourActive(modeParam === 'demo');
        localStorage.setItem('rev_eval_mode', modeParam);
      }

      const superuserParam = params.get('superuser');
      if (superuserParam === 'admin' || superuserParam === '1' || superuserParam === 'true') {
        const u = SUPERUSER_PROFILES.admin;
        setUser(u);
        localStorage.setItem('rev_user', JSON.stringify(u));
        setInitialized(true);
        return;
      }
      if (superuserParam === 'developer' || superuserParam === 'dev') {
        const u = SUPERUSER_PROFILES.developer;
        setUser(u);
        localStorage.setItem('rev_user', JSON.stringify(u));
        setInitialized(true);
        return;
      }

      // Check localStorage
      const saved = localStorage.getItem('rev_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.role === 'admin' || parsed.role === 'developer' || parsed.role === 'departing')) {
          setUser(parsed);
        }
      }
    } catch {
      // LocalStorage or URL parse error
    } finally {
      setInitialized(true);
    }
  }, []);

  function setEvalMode(mode: EvalMode) {
    setEvalModeState(mode);
    setTourActive(mode === 'demo');
    if (mode === 'demo') setTourStep(1);
    try {
      localStorage.setItem('rev_eval_mode', mode);
    } catch {}
  }

  function loginAsSuperuser(targetRole: UserRole, mode?: EvalMode) {
    const profile = SUPERUSER_PROFILES[targetRole];
    setUser(profile);
    if (mode) {
      setEvalModeState(mode);
      setTourActive(mode === 'demo');
      if (mode === 'demo') setTourStep(1);
      try {
        localStorage.setItem('rev_eval_mode', mode);
      } catch {}
    }
    try {
      localStorage.setItem('rev_user', JSON.stringify(profile));
    } catch {}
  }

  function loginWithCredentials(name: string, email: string, targetRole: UserRole) {
    const profile: UserProfile = {
      name: name || (targetRole === 'admin' ? 'Jordan Rivera' : 'Alex Vance'),
      role: targetRole,
      title: targetRole === 'admin' ? 'Tech Lead / Admin' : 'Successor Developer',
      avatar: targetRole === 'admin' ? '👑' : '👤',
      email,
    };
    setUser(profile);
    try {
      localStorage.setItem('rev_user', JSON.stringify(profile));
    } catch {}
  }

  function logout() {
    setUser(null);
    try {
      localStorage.removeItem('rev_user');
    } catch {}
  }

  // Prevent flash during hydration
  if (!initialized) {
    return null;
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user ? user.role : null,
        evalMode,
        setEvalMode,
        tourActive,
        setTourActive,
        tourStep,
        setTourStep,
        loginAsSuperuser,
        loginWithCredentials,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
