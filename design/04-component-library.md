# Bileşen Kütüphanesi ve Kullanım Kuralları

## Temel bileşenler
- `AppShell`, `Sidebar`, `Topbar`, `MobileTabBar`
- `PageHeader`, `Breadcrumbs`, `ProjectSwitcher`
- `Button` (primary/secondary/tertiary/destructive)
- `TextField`, `TextArea`, `Select`, `DatePicker`, `NumberField`, `CurrencyField`
- `StatusBadge`, `PriorityBadge`, `SyncStatus`
- `Card`, `KpiCard`, `EmptyState`, `ErrorState`, `LoadingSkeleton`
- `DataTable`, `FilterBar`, `Pagination`, `MobileRecordCard`
- `ConfirmDialog`, `Drawer`, `BottomSheet`, `Toast`
- `PhotoPicker`, `MediaGallery`, `FileAttachment`
- `AuditTimeline`, `ApprovalStatus`, `OfflineBanner`

## Buton hiyerarşisi
- Primary: sayfada tek ana aksiyon.
- Secondary: iptal, filtre, alternatif aksiyon.
- Tertiary/ghost: düşük öncelikli.
- Destructive: silme/iptal; normal primary ile aynı görsel ağırlıkta olmasın.

## Form kontrolleri
- Label ve açıklama metni bulunur.
- Zorunluluk sadece placeholder ile anlatılmaz.
- Sayı/tutar alanları birim ve para birimini açıkça gösterir.
- Otomatik formatlama veri kaydını bozmamalı.
- Hata mesajı nasıl düzeltileceğini söylemeli.

## Durum bileşenleri
- `Taslak`, `Gönderildi`, `Onaylandı`, `Reddedildi`, `Senkron bekliyor`, `Hata` gibi metinler kullanılmalı.
- Badge renkleri tasarım token'larından gelir.
- Renk körlüğünde ayırt edilebilirlik için metin/ikon zorunlu.

## Erişilebilirlik
- Klavye ile tüm web aksiyonlarına erişim.
- Focus görünür.
- Modal açılınca focus içeride; kapanınca tetikleyiciye döner.
- Form alanlarında erişilebilir isim ve hata bağlantısı.
- Görselde anlamlı alt text.
