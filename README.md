<div align="center">

# 🏗️ ŞantiyePro

**Şantiye ve inşaat takip platformu — saha mobil uygulaması, web yönetim paneli ve API**

[![CI](https://github.com/aliyuzerler/SantiyePro/actions/workflows/ci.yml/badge.svg)](https://github.com/aliyuzerler/SantiyePro/actions/workflows/ci.yml)
![Faz](https://img.shields.io/badge/faz-01%20tamamlandı-14263D)
![Test](https://img.shields.io/badge/test%20kapısı-47%20test-D99A2B)

*React Native + Expo · Next.js · NestJS · PostgreSQL*

</div>

---

## 📌 Genel Bakış

ŞantiyePro; inşaat firmalarının şantiyelerini tek panelden yönetmesi için geliştirilen, **tek müşteri kurulumlu** (single-tenant) bir yönetim platformudur. Saha ekibi çevrimdışı çalışabilen mobil uygulamayla günlük rapor, puantaj, depo ve gider kayıtlarını tutar; yönetim panelinden proje ilerlemesi, hakedişler ve raporlar izlenir.

Ürünün temel ilkeleri:

- **Çevrimdışı-öncelikli saha uygulaması** — bağlantı yoksa kayıt yerel SQLite'a yazılır, bağlantı gelince outbox kuyruğuyla sunucuya aktarılır (`docs/09-offline-sync.md`).
- **Rol tabanlı erişim (RBAC) + proje kapsamı** — her kullanıcı yalnızca yetkili olduğu proje ve rol kapsamındaki veriyi görür; IDOR koruması tüm uçlarda zorunludur.
- **Değiştirilemez kayıtlar** — stok hareketleri, hakediş ve ilerleme kayıtları append-only tutulur; tüm kritik işlemler **denetim günlüğüne** (audit log) yazılır.
- **Tasarım sistemi tek kaynağı** — `design/tokens.json` web, mobil ve API dokümantasyonu için ortak token kaynağıdır; üç taraf arasında parite testleriyle kilitlenir.
- **Abonelik / ödeme yok** — tek seferlik kurulum lisansı (ADR-001, ADR-004).

## 🖼️ Ekran Görüntüleri

### Web Yönetim Paneli (Faz 01)

| Genel Bakış | Projeler |
| --- | --- |
| ![Web panel genel bakış](docs/screenshots/panel-desktop-home.png) | ![Web panel projeler](docs/screenshots/panel-desktop-projects.png) |

| Görevler | API Dokümantasyonu (Swagger) |
| --- | --- |
| ![Web panel görevler](docs/screenshots/panel-desktop-gorevler.png) | ![Swagger](docs/screenshots/api-swagger.png) |

### Mobil Kabuk (Faz 01)

| Alt navigasyon + kayıt menüsü FAB | Gezinme çekmecesi |
| --- | --- |
| ![Mobil ana ekran](docs/screenshots/panel-mobile-home.png) | ![Mobil çekmece](docs/screenshots/panel-mobile-drawer.png) |

> Mobil kabuğun tarayıcı önizlemesidir; asıl hedef Expo ile derlenen React Native uygulamasıdır (`apps/mobile`). Ekran görüntüleri `docs/screenshots/` altında sürüm kontrolünde tutulur.

## 🧱 Mimari

```text
┌─────────────────┐     ┌──────────────────────┐
│  Mobil (Expo)   │     │  Web Panel (Next.js) │
│  offline-first  │     │  yönetim arayüzü     │
└────────┬────────┘     └──────────┬───────────┘
         │  REST /api/v1           │
         ▼                         ▼
┌─────────────────────────────────────────────┐
│           API — NestJS (modüler monolit)    │
│  Auth/RBAC · Projeler · Görevler · Raporlar │
│  Puantaj · Depo · Gider/Hakediş · Denetim   │
└────────────────────┬────────────────────────┘
                     ▼
      ┌──────────────────────┐   ┌───────────────────┐
      │  PostgreSQL 16/17    │   │  MinIO (S3) medya │
      └──────────────────────┘   └───────────────────┘
```

- **Modüler monolit:** Tek dağıtım birimi; modüller faz bazında ayrı NestJS modülleri olarak büyür (`docs/03-architecture.md`).
- **Paylaşılan sözleşmeler:** DTO/şemalar ve tasarım token'ları `packages/contracts` içinde; API, web ve mobil aynı kaynaktan beslenir.
- **Ortak yapılandırma:** `packages/config` strict TypeScript + ESLint tabanı.

## 🗺️ Faz Yol Haritası

Geliştirme `prompts/README.md` içindeki faz sırasına göre yürür; her faz **önce geliştirme promptu, ardından test promptu** ile kapanır ve test raporu `docs/test-reports/` altına yazılır. Testleri geçmeyen faz kapanmaz.

| Faz | Kapsam | Durum |
| --- | --- | --- |
| 00 | Monorepo iskeleti, CI, yerel PostgreSQL, health uçları | ✅ Tamamlandı |
| 01 | Tasarım sistemi, token paritesi, web panel kabuğu + mobil kabuk | ✅ Tamamlandı |
| 02 | Kimlik doğrulama, kullanıcılar, RBAC, denetim günlüğü | 🔄 Devam ediyor |
| 03 | Projeler ve ekip yönetimi | ⬜ |
| 04 | Görevler | ⬜ |
| 05 | Günlük raporlar ve medya | ⬜ |
| 06 | Puantaj | ⬜ |
| 07 | Depo / stok | ⬜ |
| 08 | Giderler ve hakedişler | ⬜ |
| 09 | Çevrimdışı senkronizasyon | ⬜ |
| 10 | Raporlar, denetim görünümleri, yedekleme | ⬜ |
| 11 | Üretim sertleştirme | ⬜ |

Faz raporları: [phase-00](docs/test-reports/phase-00.md) · [phase-01](docs/test-reports/phase-01.md)

## 🚀 Hızlı Başlangıç

### Gereksinimler

- Node.js >= 20 (önerilen 22/24)
- pnpm (`corepack enable` veya `npm i -g pnpm`)
- PostgreSQL 16+ — Docker varsa Compose ile, yoksa `pnpm local:pg` ile

### Kurulum

```bash
pnpm install

# 1) Veritabanı
#    Docker'lı ortam:
docker compose -f infra/docker/compose.dev.yml up -d
#    Docker'sız ortam (yerel PostgreSQL 17 daemon):
pnpm local:pg

# 2) API ortam dosyası
cp .env.example apps/api/.env   # değerleri ortamınıza göre düzenleyin

# 3) Prisma client üretimi
pnpm --filter @santiyepro/api prisma:generate

# 4) Paylaşılan paketi derle (API runtime dist kullanır)
pnpm --filter @santiyepro/contracts build

# 5) Geliştirme sunucuları (ayrı terminaller)
pnpm dev:api      # http://localhost:4000/api/v1/health
pnpm dev:web      # http://localhost:3100
pnpm dev:mobile   # Expo DevTools (Expo Go ile cihazda)
```

## 🧪 Test ve Kalite Kapısı

Her fazda aşağıdaki komutlar yeşil olmadan faz kapanmaz:

```bash
pnpm lint        # tüm workspace
pnpm typecheck   # tüm workspace
pnpm test        # birim + e2e testler
pnpm build       # contracts -> api/web derlemesi
```

**Mevcut test envanteri (Faz 01 itibarıyla — 47 test):**

| Paket | Araç | Kapsam |
| --- | --- | --- |
| `packages/contracts` | Vitest | Tasarım token paritesi (`tokens.json` ↔ kod) |
| `apps/api` | Vitest | Health birim testleri + e2e (envelope, trace id, readiness) |
| `apps/web` | Vitest + Testing Library | Token CSS paritesi, UI bileşenleri, kabuk (20 test) |
| `apps/mobile` | Jest + RNTL | Token köprüsü, UI, kayıt menüsü, gezinme kabuğu (17 test) |

Yerel tam yığın doğrulama (Docker'sız):

```bash
bash infra/scripts/health-check.sh
# PostgreSQL + API'yi başlatır; /health, /health/live, /health/ready, /docs uçlarını doğrular; kapatır.
```

## 🐳 Docker (Müşteri / Üretim Kurulumu)

```bash
cd infra/docker
cp ../../.env.example .env   # secret'ları doldurun
docker compose up -d --build
```

Üretim profili: `web` + `api` + `db` (private network, dışarıya kapalı) + `object-storage` (MinIO) + `proxy` (Caddy/TLS). Detay: `docs/10-deployment-backup.md`.

## 📚 Dokümantasyon Haritası

| Konum | İçerik |
| --- | --- |
| `docs/01-product-brief.md` | Ürün tanımı ve hedefler |
| `docs/02-scope-and-acceptance.md` | Kapsam ve kabul kriterleri |
| `docs/03-architecture.md` | Mimari kararlar, modüler monolit |
| `docs/04-data-model.md` | Veri modeli |
| `docs/05-api-contracts.md` | API sözleşmeleri |
| `docs/06-roles-permissions.md` | Rol-izin matrisi |
| `docs/07-security-rules.md` | Güvenlik kuralları (Argon2id, token stratejisi, IDOR) |
| `docs/09-offline-sync.md` | Çevrimdışı senkronizasyon protokolü |
| `docs/10-deployment-backup.md` | Kurulum ve yedekleme |
| `docs/11-testing-strategy.md` | Test stratejisi |
| `docs/adr/` | Mimari karar kayıtları (ADR) |
| `design/` | Tasarım sistemi, token'lar, ekran spec'leri |
| `rules/` | Genel / mobil / backend / UI-UX / test kuralları |
| `prompts/` | Faz bazlı geliştirme ve test promptları |

## 🔐 Güvenlik Notları

- Şifreler **Argon2id** ile saklanır; token'lar mobilde SecureStore'da tutulur (AsyncStorage yasak).
- Access + refresh token rotasyonu, yeniden kullanım tespiti ve denetim günlüğü Faz 02'de devreye alınır.
- Gerçek secret'lar repoya girmez; `.env.example` yalnızca değişken adlarını içerir (`.gitignore`).

## 📄 Lisans ve Ticari Model

Tek seferlik kurulum/kullanım lisansı; abonelik, uygulama içi ödeme veya online lisans kontrolü **yoktur** (ADR-001, ADR-004).
