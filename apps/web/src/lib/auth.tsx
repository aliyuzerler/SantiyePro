'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { UserDto } from '@santiyepro/contracts';
import { ApiError, authApi } from './api';

/**
 * Oturum sağlayıcısı (Faz 02):
 * - Access token yalnızca bellekte (ref) tutulur; kalıcı depolama kullanılmaz.
 * - Uygulama açılışında HttpOnly refresh cookie ile oturum yenilenir.
 * - Kullanıcı Disable edilirse /me 401 döner → oturum temizlenir.
 */
interface AuthContextValue {
  user: UserDto | null;
  loading: boolean;
  /** Erişim belirteci (yalnızca iç kullanım; bileşenler api helper'larıyla alır). */
  getToken: () => string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef<string | null>(null);
  const router = useRouter();

  const getToken = useCallback(() => tokenRef.current, []);

  const clearSession = useCallback(() => {
    tokenRef.current = null;
    setUser(null);
  }, []);

  const boot = useCallback(async () => {
    try {
      const refreshed = await authApi.refresh();
      tokenRef.current = refreshed.accessToken;
      setUser(refreshed.user);
    } catch {
      clearSession();
    } finally {
      setLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password);
    tokenRef.current = result.accessToken;
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      if (tokenRef.current) await authApi.logout(tokenRef.current);
    } finally {
      clearSession();
      router.replace('/giris');
    }
  }, [clearSession, router]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, getToken, login, logout }),
    [user, loading, getToken, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalıdır');
  return ctx;
}

/** Yetkisiz isteklerde oturumu düşürür (mevcut kullanıcı da disable edilmiş olabilir). */
export function handleAuthFailure(error: unknown, clear: () => void): void {
  if (error instanceof ApiError && error.status === 401) clear();
}
