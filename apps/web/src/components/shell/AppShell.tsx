'use client';

import { useState, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export interface AppShellProps {
  /** Aktif sayfa başlığı — topbar breadcrumb'ında kullanılır. */
  title: string;
  children: ReactNode;
}

/**
 * Web uygulama kabuğu: sol sidebar (248px lacivert) + üst bar + içerik alanı.
 * Responsive: 1024px'te kompakt davranış, 768px altında drawer menü (design/01).
 */
export function AppShell({ title, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={title} onMenuClick={() => setDrawerOpen(true)} />
        <main className="flex-1 bg-surface-50 px-4 py-6 md:px-7 md:py-7">{children}</main>
      </div>
    </div>
  );
}
