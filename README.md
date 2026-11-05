# ŞantiyePro

Şantiye ve inşaat takip ürünü: mobil saha uygulaması (React Native + Expo), web yönetim paneli (Next.js) ve API (NestJS + PostgreSQL).

> Geliştirme planı, faz promptları ve tasarım kuralları `agents.md`, `docs/`, `design/`, `prompts/`, `rules/` altındadır. Geliştirme sırası: `prompts/README.md`.

## Depo yapısı

```text
apps/
  mobile/            # React Native + Expo (offline-first saha uygulaması)
  web/               # Next.js yönetim paneli
  api/               # NestJS API (modüler monolit)
packages/
  contracts/         # Paylaşılan DTO/şema/tip + tasarım token'ları
  config/            # Ortak tsconfig/eslint ayarları
infra/
  docker/            # Dockerfile + Compose profilleri
  scripts/           # Yerel PostgreSQL, sağlık kontrolü
docs/                # Ürün/mimari/test dokümanları + test raporları
design/              # Tasarım sistemi ve token'lar (tek kaynak: tokens.json)
```

## Gereksinimler

- Node.js >= 20 (önerilen 22/24)
- pnpm (`corepack enable` veya `npm i -g pnpm`)
- PostgreSQL 16+ ve S3 uyumlu nesne depolama — Docker varsa Compose ile, yoksa `pnpm local:pg` ile

## Hızlı başlangıç

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

## Kalite kapısı (her fazda)

```bash
pnpm lint        # tüm workspace
pnpm typecheck   # tüm workspace
pnpm test        # birim + e2e testler
pnpm build       # contracts -> api/web derlemesi
```

## Yerel sağlık kontrolü (Docker'sız)

```bash
bash infra/scripts/health-check.sh
# PostgreSQL + API'yi başlatır; /health, /health/live, /health/ready, /docs uçlarını doğrular; kapatır.
```

## Docker (müşteri/üretim kurulumu)

```bash
cd infra/docker
cp ../../.env.example .env   # secret'ları doldurun
docker compose up -d --build
```

Üretim profili: `web` + `api` + `db` (private network, dışarıya kapalı) + `object-storage` (MinIO) + `proxy` (Caddy/TLS). Detay: `docs/10-deployment-backup.md`.

## Test

- API: Vitest (birim `pnpm --filter @santiyepro/api test`, e2e `pnpm --filter @santiyepro/api test:e2e`)
- Web: Vitest + Testing Library (jsdom)
- Mobil: Jest + jest-expo + React Native Testing Library

Test raporları faz bazında `docs/test-reports/phase-XX.md` altında tutulur.

## Ortam değişkenleri

`.env.example` yalnızca değişken adlarını ve örnek/değersiz değerleri içerir. Gerçek secret'lar repoya girmez (`.gitignore`).

## Lisans ve ticari model

Tek seferlik kurulum/kullanım lisansı; abonelik, uygulama içi ödeme veya online lisans kontrolü **yoktur** (ADR-001, ADR-004).
