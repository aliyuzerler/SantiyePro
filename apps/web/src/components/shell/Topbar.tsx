'use client';

import type { UserDto } from '@santiyepro/contracts';

export interface TopbarProps {
  title: string;
  /** 768px altında menü butonu — AppShell drawer'ını açar. */
  onMenuClick: () => void;
  /** Oturum açmış kullanıcı (Faz 02). */
  user?: UserDto | null;
  /** Çıkış aksiyonu. */
  onLogout?: () => void;
}

function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? 'K';
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${a}${b}`.toUpperCase();
}

/**
 * Üst bar — breadcrumb, proje seçici (Faz 03'te aktif veriyle), oturum menüsü.
 * 768px altında hamburger menü butonu gösterir.
 */
export function Topbar({ title, onMenuClick, user, onLogout }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-border-default bg-surface-0 px-4 md:px-7">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Menüyü aç"
          onClick={onMenuClick}
          className="grid size-11 place-items-center rounded-input border border-border-default text-text-primary md:hidden"
        >
          <span aria-hidden>☰</span>
        </button>
        <p className="text-xs text-text-secondary">
          Çalışma alanı <span aria-hidden>›</span> <b className="font-semibold text-text-primary">{title}</b>
        </p>
      </div>

      <div className="flex items-center gap-3">
        {/* Proje değiştirici — Faz 03'te gerçek proje listesiyle beslenir. */}
        <select
          aria-label="Proje seçimi"
          disabled
          title="Proje modülü Faz 03'te eklenecek"
          className="hidden min-h-10 rounded-input border border-border-default bg-surface-0 px-3 text-xs text-text-secondary md:block"
          defaultValue=""
        >
          <option value="">Tüm Projeler</option>
        </select>

        {user ? (
          <div className="flex items-center gap-2">
            <div className="hidden text-right md:block">
              <p className="text-xs font-semibold text-text-primary">{user.fullName}</p>
              <p className="text-[11px] leading-4 text-text-secondary">{user.email}</p>
            </div>
            <div
              aria-label={`Oturum: ${user.fullName}`}
              title={user.fullName}
              className="grid size-9 place-items-center rounded-full bg-[#dce7f0] text-sm font-extrabold text-brand-900"
            >
              {initialsOf(user.fullName)}
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="min-h-10 rounded-input border border-border-default bg-surface-0 px-3 text-xs font-semibold text-text-primary hover:bg-surface-50"
              >
                Çıkış
              </button>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}
