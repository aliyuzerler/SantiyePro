# Phase 11 — Üretime Hazırlık ve Son Sertleştirme

## Geliştirme promptu

Tüm `docs/07-security-rules.md`, `docs/08-performance-rules.md`, `docs/10-deployment-backup.md`, `docs/11-testing-strategy.md`, `docs/12-release-checklist.md` ve `agents.md` dosyalarını oku.

Bu fazda yeni iş modülü ekleme. Ürünü üretim kalitesine getir:
- OWASP tarzı uygulama güvenliği kontrolü: auth, IDOR, injection, XSS, CSRF, CORS, upload, rate limiting, secrets.
- Dependency audit, secret scanning, static checks.
- API pagination/index/query review; kritik sorgularda EXPLAIN.
- Mobil bellek/görsel performansı, offline queue büyümesi ve retry limitleri.
- Error boundary, merkezi hata yönetimi, trace ID ve yapılandırılabilir log.
- Production Docker image'ları non-root kullanıcıyla çalışmalı; minimal image ve healthcheck.
- `.env.example`, kurulum, upgrade, rollback, backup, restore ve müşteri admin kullanım dokümanları.
- Android release build yönergesi; iOS build için gerekli hesap/sertifika adımlarını belgele.
- Sürüm numarası, release notes ve müşteriye teslim checklist'i.
- Abonelik, ödeme, otomatik yenileme ve online lisans kontrolünün bulunmadığını doğrula.

Bulunan açıkları önem derecesine göre düzelt. Gerçek production secret'ı veya gerçek müşteri verisini testte kullanma. Çözülemeyen riski açıkça belgeleyip release blocker olarak işaretle.
