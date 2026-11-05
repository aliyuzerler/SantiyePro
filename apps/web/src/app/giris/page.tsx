'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { authApi } from '@/lib/api';

type Mode = 'loading' | 'login' | 'setup';

/**
 * Giriş ekranı (Faz 02).
 * Sistemde hiç kullanıcı yoksa güvenli ilk kurulum formu gösterilir:
 * kurulum anahtarı (ADMIN_SETUP_TOKEN) + ilk firma yöneticisi bilgileri.
 * Varsayılan parola yoktur — parola operatör tarafından bu ekranda belirlenir.
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('loading');

  // Giriş formu
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  // Kurulum formu
  const [setupToken, setSetupToken] = useState('');
  const [fullName, setFullName] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupError, setSetupError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    authApi
      .setupStatus()
      .then((res) => {
        if (!cancelled) setMode(res.setupRequired ? 'setup' : 'login');
      })
      .catch(() => {
        if (!cancelled) setMode('login');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setLoginError(undefined);
    try {
      await authApi.login(email, password);
      router.replace('/');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Giriş başarısız');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSetup(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSetupError(undefined);
    try {
      await authApi.bootstrap({ setupToken, fullName, email, password: setupPassword });
      await authApi.login(email, setupPassword);
      router.replace('/');
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Kurulum başarısız');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-600">ŞantiyePro</p>
          <h1 className="mt-1 text-2xl font-bold text-text-primary">
            {mode === 'setup' ? 'İlk Kurulum' : 'Yönetim Paneli'}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {mode === 'setup'
              ? 'İlk firma yöneticisini oluşturun. Kurulum anahtarı sunucu yöneticisi tarafından verilir.'
              : 'Saha operasyonlarınızı tek panelden yönetin.'}
          </p>
        </div>

        <div className="rounded-card border border-border-default bg-surface-0 p-6 shadow-sm">
          {mode === 'loading' && (
            <p className="text-sm text-text-secondary" aria-busy="true">
              Yükleniyor…
            </p>
          )}

          {mode === 'login' && (
            <form onSubmit={onLogin} className="flex flex-col gap-4" noValidate>
              <TextField
                label="E-posta"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={loginError}
                placeholder="ornek@firma.com"
              />
              <TextField
                label="Parola"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="submit" loading={submitting} loadingLabel="Giriş yapılıyor…">
                Giriş Yap
              </Button>
            </form>
          )}

          {mode === 'setup' && (
            <form onSubmit={onSetup} className="flex flex-col gap-4" noValidate>
              <TextField
                label="Kurulum Anahtarı"
                type="password"
                autoComplete="off"
                required
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                helpText="Sunucu yöneticisinin ADMIN_SETUP_TOKEN ortam değişkenine karşılık gelir."
                error={setupError}
              />
              <TextField
                label="Ad Soyad"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
              <TextField
                label="E-posta"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <TextField
                label="Parola"
                type="password"
                autoComplete="new-password"
                required
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
                helpText="En az 10 karakter; büyük/küçük harf ve rakam içermelidir."
              />
              <Button type="submit" loading={submitting} loadingLabel="Kurulum yapılıyor…">
                Kurulumu Tamamla
              </Button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-text-secondary">
          Oturum güvenliği: Argon2id parola saklama, refresh token rotasyonu ve denetim günlüğü.
        </p>
      </div>
    </main>
  );
}
