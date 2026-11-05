'use client';

export interface TopbarProps {
  title: string;
  /** 768px altında menü butonu — AppShell drawer'ını açar. */
  onMenuClick: () => void;
}

/**
 * Üst bar — breadcrumb, proje seçici (Faz 03'te aktif veriyle), kullanıcı menüsü.
 * 768px altında hamburger menü butonu gösterir.
 */
export function Topbar({ title, onMenuClick }: TopbarProps) {
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
        <div
          aria-label="Kullanıcı menüsü (Faz 02'de oturum bilgisiyle aktif olacak)"
          title="Oturum Faz 02'de eklenecek"
          className="grid size-9 place-items-center rounded-full bg-[#dce7f0] text-sm font-extrabold text-brand-900"
        >
          SP
        </div>
      </div>
    </header>
  );
}
