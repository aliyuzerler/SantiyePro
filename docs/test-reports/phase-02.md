# Faz 02 Test Raporu — Kimlik Doğrulama, Kullanıcılar, RBAC

- **Faz:** 02 — Authentication, Users, RBAC
- **Tarih:** 2026-11-05
- **Durum:** ✅ KAPALI (tüm güvenlik testleri yeşil)
- **Kalite kapısı:** lint ✅ · typecheck ✅ · build ✅ · **88 test ✅** (contracts 1 · API birim 10 · API e2e 21 · web 30 · mobil 26)

## Kapsam

- Prisma ilk iş modelleri: `User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `ProjectMember` (Project FK'sı Faz 03'te), `RefreshToken`, `PasswordResetToken`, `AuditLog` (append-only).
- **Argon2id** parola hash'i (OWASP: m=19456, t=2, p=1) — `@node-rs/argon2`, çıktı `$argon2id$` doğrulanır.
- İlk admin **bootstrap** akışı: `ADMIN_SETUP_TOKEN` ortam değişkeni ile tek kullanımlık kurulum; **varsayılan parola yok** (parola operatör tarafından kurulum ekranında belirlenir). Setup-token karşılaştırması constant-time.
- Uçlar: `POST /auth/bootstrap`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `GET /auth/setup-status`; `GET/POST/PATCH /users`, `GET /roles`.
- **Refresh token rotasyonu** (her yenilemede yeni token, eski `revokedAt`+`replacedBy`) ve **reuse tespiti** (iptal edilmiş token yeniden gelirse tüm aile iptal edilir + audit).
- **Deny-by-default RBAC:** global `JwtAuthGuard` + `PermissionsGuard` (APP_GUARD), `@Public()` istisnaları, `@RequirePermissions()`; rol→izin matrisi `packages/contracts/src/rbac.ts` tek kaynak (docs/06) + seed.
- **Kullanıcı yönetimi:** oluşturma, rol atama, disable; **disable → tüm refresh token'ları iptal**; kendi kendini disable engeli; rol değişikliği ayrı audit olayı.
- **Web:** giriş ekranı (`/giris`, kurulum gerekiyorsa güvenli ilk kurulum formu), `AuthProvider` (access token yalnızca bellekte; refresh HttpOnly cookie `SameSite=Strict`, prod'da `Secure`), korumalı `(panel)` layout, `/kullanicilar` gerçek veri (liste + oluştur + rol/durum yönetimi, izne göre aksiyonlar), Topbar oturum menüsü + Çıkış.
- **Mobil:** `expo-secure-store` ile token saklama (AsyncStorage/SQLite yasak; testte yapısal doğrulama), login ekranı, `AuthProvider`, oturum yoksa giriş / varsa ana kabuk.
- **Audit:** login başarısız/başarılı/rate-limited, refresh reuse/reject, bootstrap rejected/completed, parola değişim/sıfırlama, user created/updated/disabled/role_changed; **before/after maskeleme** (password*, token* alanları asla yazılmaz — birim testli).
- **Rate limit:** kayan pencere (IP 30/15dk, e-posta 5/15dk), artan gecikme + generic mesaj; Faz 11'de Redis'e taşınma notu.
- **CI:** PostgreSQL 16 servis konteyneri + `prisma migrate deploy` + gerçek DB üzerinde auth e2e.

## Test promptu (prompts/phase-02-test.md) madde madde sonuçlar

| # | Güvenlik maddesi | Sonuç | Kanıt (e2e/birim) |
|---|---|---|---|
| 1 | Doğru/yanlış parola; kullanıcı var/yok sızması | ✅ | e2e: yanlış parola ve olmayan kullanıcı **aynı generic mesaj** döndürür; forgot-password her zaman 202 |
| 2 | Parola DB'de hash; düz metin yok | ✅ | e2e: `passwordHash` `$argon2id$` formatında, düz metin parola gövdede yok |
| 3 | Access TTL, refresh rotasyonu, reuse, logout revoke | ✅ | e2e: rotasyon sonrası eski token 401; **reuse → ailenin tamamı 401**; logout sonrası refresh 401 |
| 4 | Disable edilen kullanıcının refresh token'ı reddedilir | ✅ | e2e: PATCH status DISABLED → aktif refresh 401; yeni login de generic 401 |
| 5 | Yetkisiz rol endpoint'e erişemiyor | ✅ | e2e: FIELD_WORKER `/users` → 403; PM listeyi görür ama yönetemez (PATCH → 403) |
| 6 | IDOR benzeri kayıt erişim engeli | ✅ | e2e: FIELD_WORKER kendi kaydını PATCH edemez (403); izinler deny-by-default |
| 7 | Rate limit ve generic hata | ✅ | e2e: 5. denemeye kadar 401, 6. deneme `RATE_LIMITED` kodlu 401; zarf sözleşmesi korunur |
| 8 | Web cookie HttpOnly/Secure/SameSite | ✅ | e2e: `HttpOnly` + `SameSite=Strict` doğrulanır; `Secure` bayrağı `COOKIE_SECURE=true` / NODE_ENV=production ile açılır (CI'da env ile, prod kurulumda zorunlu) |
| 9 | Mobil token SecureStore'da; AsyncStorage/SQLite yok | ✅ | mobil test: `SecureStore.setItemAsync` çağrıları doğrulanır; AsyncStorage bağımlılığı çözümlenemez (yapısal kural testi) |
| 10 | İlk admin akışı güvenli ve tek kullanımlık | ✅ | e2e: yanlış token 403 + audit; doğru token 201; tekrar 409; kullanıcı varken `setup-status=false` |

Ek: parola değişiminde diğer oturumların düşürülmesi (e2e), rol değişikliği audit kaydı before/after rollerle (e2e), reset token tek kullanımlık + süreli (e2e), hata zarfında özel kod korunumu (`RATE_LIMITED`) — GlobalExceptionFilter güncellemesiyle.

## Komutlar

```bash
pnpm --filter @santiyepro/api test        # 10 birim test
pnpm --filter @santiyepro/api test:e2e    # 21 e2e (gerçek PostgreSQL)
pnpm --filter @santiyepro/web test        # 30 test
pnpm --filter @santiyepro/mobile test     # 26 test
pnpm lint && pnpm typecheck && pnpm build
```

## Ortam değişkenleri (Faz 02)

`ADMIN_SETUP_TOKEN` (ilk kurulum anahtarı, repoya girmez), `JWT_ACCESS_SECRET` (≥32 karakter; prod'da zorunlu), `COOKIE_SECURE` (HTTPS arkasında `true`), `NEXT_PUBLIC_API_BASE_URL` (web), `EXPO_PUBLIC_API_URL` (mobil).

## Bilinen sınırlamalar / sonraki fazlara notlar

1. Rate limiter in-memory; çoklu örnek dağıtımında Redis gerekir (Faz 11).
2. Parola sıfırlama e-postası bu fazda gönderilmez (token altyapısı hazır, teslimat Faz 11); dev ortamda token yalnızca sunucu günlüğüne yazılır, üretimde yazılmaz.
3. `ProjectMember.projectId` geçici olarak FK'sız; Project modeli Faz 03'te gelince FK + indeks eklenir.
4. Mobil refresh otomatikleştirme Faz 09 (çevrimdışı senkron) senkron katmanına entegre edilecek; uçlar hazır.
5. Manuel QA (cihazda): Android/iOS gerçek cihazda SecureStore davranışı ve klavye/safe-area kontrolü Expo Go ile yapılmalı.
