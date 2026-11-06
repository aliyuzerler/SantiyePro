export interface NavItem {
  label: string;
  href: string;
  /** Geçici outline ikonlar — Lucide Faz 02+ bağımlılık kararıyla eklenecek. */
  icon: string;
  /**
   * Bu menü öğesini görebilme izni (Faz 10): öğe sidebar'da gizlenir; bu,
   * backend yetkisinin yerine GEÇMEZ (design/03, docs/07) — uçlarda
   * PermissionsGuard deny-by-default devam eder.
   */
  permission?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Web paneli menüsü — design/03 menü listesi.
 * Menü öğelerinin görünürlüğü izinlere göre filtrelenir (Sidebar); bu, backend
 * yetkisinin yerine geçmez (design/03).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Çalışma alanı',
    items: [
      { label: 'Genel Bakış', href: '/', icon: '▦' },
      { label: 'Projeler', href: '/projeler', icon: '▤' },
      { label: 'Görevler', href: '/gorevler', icon: '✓' },
      { label: 'Günlük Raporlar', href: '/gunluk-raporlar', icon: '▧' },
    ],
  },
  {
    title: 'Operasyon',
    items: [
      { label: 'Personel & Puantaj', href: '/puantaj', icon: '♙' },
      { label: 'Depo & Malzemeler', href: '/depo', icon: '▣' },
      { label: 'Giderler', href: '/giderler', icon: '₺' },
      { label: 'Hakedişler', href: '/hakedisler', icon: '▥' },
      { label: 'Raporlar', href: '/raporlar', icon: '▤' },
    ],
  },
  {
    title: 'Yönetim',
    items: [
      { label: 'Kullanıcılar & Yetkiler', href: '/kullanicilar', icon: '⚙' },
      { label: 'Denetim Kayıtları', href: '/denetim-kayitlari', icon: '≡', permission: 'audit.view' },
      { label: 'Ayarlar', href: '/ayarlar', icon: '⚙' },
    ],
  },
];
