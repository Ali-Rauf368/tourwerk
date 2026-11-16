import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setToken, setUnauthorizedHandler } from '../lib/api';
import type { User } from '../lib/types';

interface AuthState {
  user: User | null;
  token: string | null;
  ready: boolean;
  login(email: string, password: string): Promise<User>;
  logout(): void;
}

const AuthContext = createContext<AuthState | null>(null);
const KEY = 'tourwerk.session';

function readSession(): { token: string; user: User } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(readSession);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setToken(null);
    setSession(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    setToken(session?.token ?? null);
    setReady(true);
  }, [session, logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/auth/login', { body: { email, password } });
    setToken(res.token);
    setSession(res);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(res));
    } catch {
      /* storage unavailable */
    }
    return res.user;
  }, []);

  const value = useMemo(() => ({ user: session?.user ?? null, token: session?.token ?? null, ready, login, logout }), [session, ready, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
