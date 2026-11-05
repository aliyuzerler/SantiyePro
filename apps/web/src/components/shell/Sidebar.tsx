'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_SECTIONS } from './navigation';

export interface SidebarProps {
  /** Mobil breakpoint'te drawer açık mı. */
  open?: boolean;
  onClose?: () => void;
}

/**
 * Sol sidebar — 248px lacivert yüzey (tokens.json layout).
 * 1024px altında kompakt, 768px altında drawer davranışı; aktif öğe amber inset ile işaretlenir.
 */
export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  const content = (
    <div className="flex h-full flex-col bg-brand-900 text-[#eaf0f6]">
      <div className="flex items-center gap-3 px-6 pb-7 pt-6">
        <div className="grid size-9 place-items-center rounded-lg bg-accent-500 text-lg font-black text-brand-900">
          Ş
        </div>
        <div>
          <strong className="text-[17px] tracking-wide">ŞantiyePro</strong>
          <small className="block text-[10px] uppercase tracking-[0.12em] text-[#aebdcb]">Project Control</small>
        </div>
      </div>

      <nav aria-label="Ana menü" className="flex-1 overflow-y-auto pb-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="px-6 pb-2 pt-4 text-[10px] uppercase tracking-[0.12em] text-[#8fa2b6]">{section.title}</p>
            <ul>
              {section.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? 'page' : undefined}
                      className={`flex min-h-11 items-center gap-3 px-6 text-[13px] ${
                        active
                          ? 'bg-brand-800 font-bold text-white shadow-[inset_3px_0_0_var(--color-accent-500)]'
                          : 'text-[#c4d0dc] hover:bg-brand-800/60 hover:text-white'
                      }`}
                    >
                      <span aria-hidden className="w-4 text-center text-sm opacity-90">
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-[#344a64] px-6 py-4 text-[11px] leading-5 text-[#aebdcb]">
        ŞantiyePro Yönetim Paneli
        <br />
        Kurumsal saha operasyonları
      </div>
    </div>
  );

  return (
    <>
      {/* Masaüstü sabit sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[var(--spacing-sidebar)] shrink-0 md:block">{content}</aside>

      {/* Mobil drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menü">
          <div className="absolute inset-0 bg-brand-900/50" onClick={onClose} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-72 shadow-xl">{content}</div>
        </div>
      )}
    </>
  );
}
