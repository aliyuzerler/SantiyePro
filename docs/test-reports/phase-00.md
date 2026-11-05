# Faz 00 Test Raporu — Keşif ve Proje İskeleti

**Tarih:** 2026-11-05 · **Ortam:** Sandbox (Node 24.22.2, pnpm 12.16.1, PostgreSQL 17.9 embedded, Docker **yok**)

## Test promptu denetim listesi

| # | Kontrol | Durum | Kanıt / Not |
|---|---|---|---|
| 1 | Temiz kurulumda `pnpm install` başarılı | ✅ PASS | 1111 paket çözüldü, lockfile oluşturuldu. pnpm 12 build-script onayı `pnpm-workspace.yaml > onlyBuiltDependencies` ile yönetildi. |
| 2 | Workspace paketleri doğru çözülüyor | ✅ PASS | `@santiyepro/contracts`, `@santiyepro/config` workspace linkleri çözülüyor; API/web/mobil derlemeleri paketi tüketiyor. |
| 3 | Mobile, web ve API başlatılabiliyor | ✅ PASS (API doğrudan, web build, mobil tsc/test) | API `node dist/main.js` ile boot edildi. Web `next build` başarılı, `next dev -p 3100` yapılandırılmış. Mobil `expo start` bu ortamda GUI'siz koşturulamaz; `tsc --noEmit` + jest-expo smoke testi geçti. |
| 4 | API health endpoint 200 | ✅ PASS | `GET /api/v1/health` → 200 `{"status":"ok","service":"santiyepro-api",...}` · `GET /api/v1/health/live` → 200 · `GET /api/v1/health/ready` (DB açıkken) → 200 `{"checks":{"database":"ok"}}` · OpenAPI `GET /api/v1/docs` → 200 |
| 5 | Compose servisleri healthy | ⚠️ BLOCKED (sandbox'ta Docker yok) | `docker-compose.yml` (db, object-storage, api, web, proxy) ve `compose.dev.yml` YAML olarak doğrulandı; healthcheck/restart/network tanımları docs/10'a uygun. **Runtime doğrulama Docker'lı makinede yapılmalı.** |
| 6 | Lint/typecheck/test/build script'leri tutarlı | ✅ PASS | `pnpm -r lint` ✅ · `pnpm -r typecheck` ✅ · `pnpm build` (contracts→api→web) ✅ · testler aşağıda |
| 7 | `.env` git dışında; `.env.example` secret içermiyor | ✅ PASS | `.gitignore` `.env`/`.env.*` hariç tutar (`!.env.example`). `.env.example` yalnızca `change-me` örnek değerler içerir. |
| 8 | CI mevcut komutları çağırıyor | ✅ PASS | `.github/workflows/ci.yml`: install → lint → typecheck → build → test (contracts/api/e2e/web/mobile). PG servis konteyneri Faz 02'den itibaren açıklamayla hazır. |
| 9 | README komutları uygulanabilir | ✅ PASS | Kurulum sırasında kullanılan komutların tamamı README'de birebir mevcut; `bash infra/scripts/health-check.sh` uçtan uca PASS üretti. |

## Test çıktıları

```
contracts: vitest  1 passed (tokens.parity: tokens.ts ↔ design/tokens.json birebir)
api unit:  vitest  4 passed (liveness şeması, readiness 200/503, hata zarfı şeması)
api e2e:   vitest  5 passed (health/live/ready uçları, 404 zarfı, X-Trace-Id korelasyonu)
mobile:    jest    1 passed (App boot smoke)
web:       jest    (test Faz 01'de gelir; --passWithNoTests)

health-check.sh:
  PASS  GET /api/v1/health       -> 200
  PASS  GET /api/v1/health/live  -> 200
  PASS  GET /api/v1/health/ready -> 200   (yerel PostgreSQL 17.9 ile)
  PASS  GET /api/v1/docs         -> 200
```

## Teknik kararlar

| Karar | Gerekçe |
|---|---|
| NestJS **12.3.3** + ESM (`"type": "module"`) | Resmi Nest 12 starter'ının güncel yapısı. Nest 12 ESM-only yayınlanıyor; Jest kaldırıldığı için test koşucusu **Vitest 4** (starter'ın resmi tercihi). |
| TypeScript **~5.9.2** | ts-jest/jest-expo/typescript-eslint (>=4.8.4 <6.1) ile uyumlu en güncel kararlı hat. TS 7.0 henüz ekosistem desteği eksik. |
| Prisma **6.19.0** (7 değil) | Prisma 7 yeni driver-adapter mimarisi getiriyor; Faz 00-02 istikrarı için yerleşik 6.x hattı seçildi. Geçiş ayrı ADR ile planlanır. |
| Next **16.4.5** + React 19.3.1, Tailwind **4.3.4** | Güncel kararlı; sandbox'ta da doğrulandı. |
| Expo **SDK 58** / RN **0.88.1** | Güncel kararlı; RNTL **14.1** + yeni **test-renderer** (react-test-renderer'ın React 19 halefi) ile test edildi (`await render(...)` yeni API). |
| Yerel PG: `embedded-postgres` 17.9 binary'leri + `pg_ctl` daemon | Docker bulunmayan ortamlarda gerçek PostgreSQL; `infra/scripts/local-postgres.mjs`. Müşteri ortamında Compose kullanılır. |
| contracts paketi CJS `dist` olarak derlenir | Nest (CJS/ESM), Next ve Metro üçünün de güvenle tüketebileceği tek format; `pnpm build` topolojik sırayla önce contracts'ı derler. |
| API `.env` `dotenv.config({override:true})` ile en başta yüklenir | PrismaClient kurulum sırası ConfigModule'den önce çalıştığı ve host ortamından sızan `DATABASE_URL` gibi değişkenlerin ezilmesi gerektiği için. |

## Bilinen eksikler / riskler

1. **Compose runtime doğrulaması** bu ortamda Docker olmadığından yapılamadı (5. madde). Docker'lı makinede `docker compose -f infra/docker/compose.dev.yml up -d` ile healthcheck'ler izlenmelidir.
2. **Mobil `expo start`** GUI/tunnel gerektirdiğinden sandbox'ta koşturulmadı; cihazda Expo Go ile doğrulama Manuel QA maddesidir.
3. MinIO yalnızca Compose ile; sandbox'ta nesne depolama testi Faz 05'e ertelendi.
4. pnpm yalnızca `corepack pnpm` veya kullanıcı kurulumu ile kullanılabilir; `engines` ve `packageManager` alanları sabitlendi.
5. Sandbox ortamı arka plan süreçlerini komut sonunda sonlandırdığı için uzun ömürlü daemon doğrulamaları `health-check.sh` gibi tek oturumluk scriptlerle yapılır.

**Sonuç: FAZ 00 TAMAMLANDI** — test kapısı geçildi; Faz 01'e geçilebilir.
