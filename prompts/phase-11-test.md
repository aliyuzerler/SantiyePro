# Phase 11 — Final Test Promptu

Final release gate uygula. Aşağıdaki testleri gerçekten çalıştır ve kanıt/çıktı ekle:

## Build ve kalite
- Clean install, lint, typecheck, unit, integration, E2E, mobile/web/API build.
- Lockfile ve dependency audit.
- Production Docker Compose ayağa kalkıyor mu?

## Güvenlik
- Login brute-force/rate limit.
- RBAC + project scope + IDOR.
- CSRF/CORS/XSS temel kontrolleri.
- Dosya upload allowlist/size/path/signed URL.
- Secret scan ve loglarda token/parola kontrolü.
- DB public erişime kapalı mı?

## İş bütünlüğü
- Stok concurrency ve duplicate mutation.
- Puantaj duplicate ve yetki.
- Onaylı rapor revision.
- Hakediş decimal ve snapshot.
- Offline force-close/restart/sync.

## Performans
- Büyük listeler ve filtreli sorgular.
- Dashboard/API p95 ölçümü.
- Büyük fotoğraf yükleme/thumbnail.
- Mobil uzun liste ve bellek.

## Operasyon
- Sıfırdan kurulum.
- İlk admin.
- DB + dosya backup.
- İzole ortama restore.
- Upgrade ve rollback yönergesi.

Sonuçları `docs/test-reports/final-release.md` içinde PASS/FAIL/BLOCKED olarak raporla. FAIL veya BLOCKED olan kritik maddeyi gizleme. Tüm release blocker'lar kapanmadan üretime hazır olduğunu iddia etme.
