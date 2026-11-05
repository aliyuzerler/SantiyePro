# Canlı Test Standardı (Playwright E2E)

**Yürürlük:** Faz 03 kapanışından itibaren — her faz, birim/bileşen testlerinin yanında
bu standarttaki canlı E2E koşumu tamamlanmadan kapanamaz.

## Neden?

Birim testleri mock ile koşar; canlı davranışı (gerçek API, gerçek PostgreSQL, gerçek
tarayıcı, gerçek yönlendirme ve CORS akışı) doğrulamaz. Bu standart, her fazın sonunda
ürünün **canlı olarak** çalıştığını kanıtlar.

## Standardın maddeleri

Her faz kapanışında sırasıyla:

1. **Birim/bileşen kapıları** — `pnpm test` (contracts / api / web / mobile)
2. **Kalite kapıları** — `pnpm lint && pnpm typecheck && pnpm build`
3. **Canlı E2E** — `pnpm e2e` (Playwright):
   - Gerçek PostgreSQL (`pnpm local:pg`) + gerçek API (dist build) + panel dev sunucusu
     üzerinde koşar; `apps/web-e2e/playwright.config.ts` sunucuları kendi başlatır,
     çalışıyorlarsa yeniden kullanır.
   - **api-health.spec.ts** — liveness + readiness (gerçek DB bağlantısı)
   - **panel-shell.spec.ts** — gerçek UI girişi → menüdeki 11 modül sayfası (masaüstü 1440×900)
   - **panel-mobile.spec.ts** — mobil 390×844 drawer akışı
   - **fazın kendi kritik akış spec'i** — o fazın ekran/ucu üzerinden uçtan uca senaryo
     (ör. Faz 04: görev oluştur → ata → durum değiştir → geçmiş)
4. **Test raporu** — `docs/test-reports/phase-XX.md` içine Playwright sonuçları ve
   varsa ekran görüntüleri (`docs/screenshots/`) eklenir.

## Koşum

```bash
pnpm build      # API dist'i güncel olsun (webServer dist'i çalıştırır)
pnpm e2e        # local:pg + Playwright (chromium)
```

- Yalnızca tek spec: `pnpm --filter @santiyepro/web-e2e test:e2e -- tasks-critical-flow.spec.ts`
- Başarısız koşumda trace `apps/web-e2e/test-results/` altında tutulur.

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `E2E_WEB_URL` | `http://localhost:3100/panel` | Panel kökü (basePath `/panel` ile) |
| `E2E_API_URL` | `http://localhost:4000/api/v1` | API kökü |
| `E2E_ADMIN_EMAIL` | `admin@santiyepro.test` | Test yöneticisi |
| `E2E_ADMIN_PASSWORD` | `GucluParola123` | Test yöneticisi parolası |

Test verisi **kendini kurar**: hiç kullanıcı yoksa güvenli bootstrap akışıyla ilk admin
açılır (`ADMIN_SETUP_TOKEN`), veri API üzerinden üretilir — birim e2e'lerle aynı
veritabanını paylaştığı için koşum sırasından bağımsızdır.

## Kurallar

- E2E testleri **yalnızca gerçek API** çağırır; mock API yoktur.
- Testler birbirine sıra bağımlı yazılmaz; her spec kendi verisini kurar.
- Sentetik/demo veri üretilmez (docs/02); sahte dashboard sayıları yoktur.
- Token/parola log'larda görünmez; varsayılan parolalar yalnızca yerel geliştirme içindir.
