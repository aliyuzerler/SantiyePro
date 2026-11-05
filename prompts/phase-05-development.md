# Phase 05 — Günlük Şantiye Raporu ve Medya

## Geliştirme promptu

`docs/02-scope-and-acceptance.md`, `docs/04-data-model.md`, `docs/05-api-contracts.md`, `docs/07-security-rules.md`, `docs/09-offline-sync.md`, `design/02-mobile-screen-spec.md` ve `design/03-web-dashboard-spec.md` dosyalarını oku.

DailyReport, DailyReportRevision, DailyReportWorker, MediaFile ve ilişkili tabloları kur. Günlük rapor formunu mobil öncelikli geliştir; web'de rapor listesi/detayı, fotoğraf galerisi ve revizyon geçmişi oluştur.

Rapor alanları: proje/şantiye, tarih, hava durumu, yapılan işler, ekip/personel özeti, ekipman, sorun/gecikme, İSG notu, ertesi gün planı, ekler. Taslak, gönder, onayla, reddet akışını uygula. Onaylı rapor düzenlenirse önceki içerik korunarak revision oluştur.

Medya güvenliği: allowlist MIME/size, server-generated storage key, signed URL, ownership check, private bucket. Görseller için thumbnail üretimi veya servis katmanı planla. EXIF GPS metadata'sı sızmamalı; ürün kararına göre strip et veya açıkça yönet.

Fotoğraf yükleme büyük dosyada zaman aşımına uğrarsa rapor metni kaybolmamalı. Bu fazda offline medya kuyruğunun temel veri yapısını hazırla; tam sync Phase 09'da uygulanacak.
