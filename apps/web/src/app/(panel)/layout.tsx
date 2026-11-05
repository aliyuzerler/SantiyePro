'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuth } from '@/lib/auth';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';

/**
 * Yönetim paneli koruması (deny-by-default):
 * Oturum açık değilse giriş ekranına yönlendirilir; açılış sırasında iskelet gösterilir.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      void router.replace('/giris');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="p-6" aria-busy="true">
        <LoadingSkeleton rows={5} />
      </div>
    );
  }

  if (!user) return null;
  return <>{children}</>;
}

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}
