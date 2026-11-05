# Phase 01 — Tasarım Sistemi ve App Shell

## Geliştirme promptu

`design/01-design-system.md`, `design/02-mobile-screen-spec.md`, `design/03-web-dashboard-spec.md`, `design/04-component-library.md` ve `design/tokens.json` dosyalarını tam oku.

Kurumsal tasarım temelini uygula:
- Web için theme/token katmanı, tipografi, spacing, renk, radius ve responsive grid.
- Mobil için aynı semantik token'ların React Native karşılıkları.
- Ortak temel bileşenler: Button, TextField, Select, Card, StatusBadge, EmptyState, ErrorState, LoadingSkeleton, ConfirmDialog/BottomSheet.
- Web AppShell: sidebar, topbar, breadcrumb, page header.
- Mobil AppShell: alt navigasyon ve `+ Kayıt` menü iskeleti.
- Ana sayfa ekranlarında gerçek veri yoksa gerçekmiş gibi KPI gösterme; açıklayıcı empty state kullan.
- Her bileşenin default, focus, disabled, loading, error hallerini tasarla.
- Erişilebilir label, klavye navigasyonu ve minimum touch target kurallarını uygula.

Bu fazda iş modüllerinin veri/API davranışını geliştirme; yalnızca uygulama kabuğu ve tasarım sistemi. Görsel kaliteyi generic admin template seviyesinde bırakma; spacing, hizalama, tablo ve form tipografisini tutarlı yap.
