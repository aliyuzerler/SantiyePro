# Phase 00 — Keşif ve Proje İskeleti

## Geliştirme promptu

Bu repoda SantiyePro ürününü geliştireceğiz. Önce `agents.md`, `docs/01`–`docs/03`, `docs/11`, `design/01` ve `prompts/README.md` dosyalarını oku. Ardından mevcut repository'yi incele: dosya yapısı, package manager, mevcut uygulamalar, test komutları, CI, env dosyaları ve eksik/çakışan kararlar.

**Bu fazda özellik modülleri geliştirme.** Önce uygulanabilir monorepo iskeletini kur:
- pnpm workspace ve TypeScript strict ortak ayarları
- `apps/mobile`, `apps/web`, `apps/api`, `packages/contracts`, `packages/config`, `infra/docker` klasörleri
- her app için minimum bootable başlangıç; gereksiz demo ekranı yok
- ESLint/Prettier ve ortak script'ler
- `.gitignore`, `.env.example` (secret içermeden), temel README
- API health endpoint ve basit health check
- Docker Compose development altyapısı: PostgreSQL ve object storage; DB portunu production için public açma
- CI: install, lint, typecheck, test, build adımları (henüz hazır olmayan adımlar açıkça ayrıştırılabilir)

Teknoloji seçiminde mimari dokümanını esas al. Paket sürümlerini uyumlu kararlı sürümlerden seç ve lockfile'a sabitle. Mevcut repo varsa yeniden yaratma; gerekenleri kontrollü entegre et.

Çıktı: repo analizi, oluşturulan/değişen dosyalar, çalıştırma komutları, teknik kararlar ve bilinen riskler. Bu fazda auth veya iş modülü yazma.
