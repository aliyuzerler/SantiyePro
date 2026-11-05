# Phase 02 — Authentication, Users, RBAC

## Geliştirme promptu

`docs/03-architecture.md`, `docs/06-roles-permissions.md` ve `docs/07-security-rules.md` dosyalarını oku.

Şunları gerçek backend ve UI akışıyla uygula:
- User, Role, Permission, UserRole, RolePermission ve ProjectMember veri modelleri/migration'ları.
- İlk admin oluşturma/kurulum akışı; varsayılan parola yok.
- Login, logout, refresh token rotation/revoke, parola değiştirme ve güvenli parola sıfırlama altyapısı.
- Argon2id parola hash'i; rate limit ve genel hata mesajları.
- NestJS guards/decorators ve deny-by-default RBAC.
- Proje kapsamı kontrolü için reusable authorization service (proje modülü Phase 03'te eklenecek; şimdilik kontrol arayüzü ve test doubles kullan, geçici izin açma).
- Web login ve kullanıcı/rol yönetimi ekranı.
- Mobil login ve token'ı SecureStore'da saklama.
- Refresh token web cookie güvenliği; mobilde SecureStore.
- Kullanıcı disable işleminde tüm refresh token'ları iptal et.
- Audit event'leri: login başarısız/başarılı, parola değişimi, kullanıcı/rol değişimi. Hassas veri loglama.

Abonelik, ödeme, lisans sunucusu veya SaaS tenant kontrolü ekleme. Auth testleri gerçek test DB üzerinde çalışmalı.
