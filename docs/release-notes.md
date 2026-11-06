# ŞantiyePro — Sürüm Notları

## v1.0.0 — İlk üretim sürümü (2026-11-06)

İlk müşteriye teslim sürümü. Tek seferlik kurulum lisansı; abonelik, ödeme,
otomatik yenileme veya online lisans kontrolü **bulunmaz** (ADR-001, ADR-004).

### Genel bakış

ŞantiyePro; inşaat firmaları için çevrimdışı çalışabilen mobil saha uygulaması,
web yönetim paneli ve NestJS API'sinden oluşan tek müşteri kurulumlu bir şantiye
yönetim platformudur.

### Özellikler (faz 00 → 11)

| Alan | Yetenek |
| --- | --- |
| Kimlik ve oturum | Argon2id parolalar, refresh token rotasyonu + reuse tespiti, HttpOnly cookie, login rate limit (IP + e-posta), ilk admin güvenli kurulum akışı |
| Kurum ve yetki | RBAC (deny-by-default), proje üyeliği scope'u, IDOR koruması, alan bazlı maskeleme |
| Projeler/şantiyeler | Proje + şantiye yapısı, üye yönetimi, proje detay |
| Görevler | Durum makinesi, checklist, yorum, atama bildirimi, termin takibi |
| Günlük rapor | Revizyon akışı (onaylı rapor revizyonu denetimli), özel medya deposu, imzalı kısa ömürlü URL, EXIF GPS soyulması, magic-sniff medya doğrulaması |
| Personel ve puantaj | Personel kartları, günlük puantaj işaretleme (tekil + toplu önizleme/onay), duplicate engeli, kurum tanımlı durumlar |
| Depo ve stok | Depolar, malzeme kartları, **append-only** stok hareketleri, transfer tek transaction, negatif stok engeli (koşullu atomik UPDATE), ters kayıt düzeltmesi |
| Gider ve hakediş | Gider kategorileri, fiş eki, onay/red akışı, hakediş kalemleri (fiyat snapshot'ı + zincir doğrulaması), dönem çakışma engeli, kuruş hassasiyetli BigInt para matematiği |
| Raporlama | 7 rapor (proje genel görünüm, günlük rapor, puantaj, stok bakiyesi/hareketleri, gider, hakediş, görev durum/termin), PDF (gömülü Türkçe font) + XLSX (gerçek hücre tipleri), export satır sınırı, sunucu tarafı sayfalama |
| Denetim | Append-only AuditLog, okuma anında yeniden maskeleme, önce/sonra görünümü, filtre/facet uçları, her export için `report.exported` kaydı |
| Çevrimdışı (mobil) | SQLite outbox + idempotency defteri (`clientMutationId`), exponential backoff + jitter, 401 güvenli refresh (kuyruk korunur), medya kuyruğu, senkronizasyon durumu kullanıcıya görünür |
| Sunucu senkronu | `/sync/push` batch (accepted/rejected/conflict), `/sync/pull` delta + tombstone, kapsam dışı veri sızmaz |
| Operasyon | `/health/live` + `/health/ready`, backup.sh/restore.sh (dry-run, sha256, retention), backup durum kartı, Docker non-root + healthcheck, Caddy TLS profili |

### Güvenlik sertleştirmesi (Faz 11)

- API: güvenlik başlıkları (nosniff, DENY, Referrer-Policy, Permissions-Policy, CORP), `x-powered-by` kaldırıldı, trust proxy yapılandırması (`TRUST_PROXY` — Caddy arkasında gerçek istemci IP'si, login rate limitinin doğruluğu için), Swagger üretimde kapalı.
- Rate limiter bellek sınırı: anahtar havuzu 10.000 ile sınırlı, en eski kayıt evict edilir (bellek şişirme saldırısına karşı).
- Web: CSP + güvenlik başlıkları (`frame-ancestors 'none'`, `object-src 'none'`), App Router error boundary'ler (`error.tsx` + `global-error.tsx`) — destek korelasyonu için hata kodu gösterimi.
- Bağımlılık taraması ve secret scanning raporu: `docs/test-reports/final-release.md`.

### Bilinen sınırlar

- Parola sıfırlama e-posta teslimatı müşteri SMTP konfigürasyonuna bağlıdır (token üretimi ve tek kullanımlık hash saklama hazırdır).
- MFA/2FA MVP kapsamı dışındadır (docs/07).
- Rate limiter tek örnek (single-node) içi; çoklu örnek dağıtımda Redis gerekir.
- Üretim Docker Compose ayağa kaldırma doğrulaması build ortamında yapılamamıştır (Docker yok) — kurulum öncesi müşteri sunucusunda `docs/operations.md` §2 ile doğrulanmalıdır. Detay: `docs/test-reports/final-release.md`.

### Yükseltme

İlk sürüm — kurulum için `docs/operations.md` §2 (Sıfırdan kurulum).
