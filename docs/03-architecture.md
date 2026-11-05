# 03 — Teknik Mimari

## Mimari yaklaşım
İlk sürüm **modüler monolit** olacaktır. Tek müşteri kurulumunda tek backend, tek PostgreSQL veritabanı ve tek nesne depolama alanı çalışır. Bu yaklaşım kurulum, hata ayıklama ve müşteri başına bakım maliyetini düşük tutar. Modüller arası sınırlar korunur; ihtiyaç doğarsa daha sonra ayrıştırılabilir.

## Sistem bileşenleri

```text
                ┌───────────────────────────┐
                │       Web Paneli          │
                │ Next.js + TypeScript      │
                └─────────────┬─────────────┘
                              │ HTTPS / REST
┌─────────────────────────────┴─────────────────────────────┐
│                    NestJS API                              │
│ Auth | Users | Projects | Tasks | Reports | Attendance    │
│ Inventory | Expenses | Progress Claims | Files | Audit    │
└──────────────┬───────────────────────────┬─────────────────┘
               │                           │
       ┌───────▼────────┐          ┌───────▼─────────┐
       │ PostgreSQL     │          │ S3 compatible  │
       │ Prisma         │          │ object storage │
       └────────────────┘          └─────────────────┘

┌───────────────────────────┐
│ React Native / Expo App   │
│ SQLite + Outbox + Media   │
│ Offline-first field work │
└─────────────┬─────────────┘
              └──────── HTTPS / REST ───────────► API
```

## Önerilen depo yapısı

```text
/apps
  /mobile                 # React Native + Expo
  /web                    # Next.js yönetim paneli
  /api                    # NestJS API
/packages
  /contracts              # paylaşılan DTO, schema ve API tipleri
  /config                 # ortak lint/tsconfig ayarları
/docs
/design
/prompts
/rules
/skills
/infra
  /docker                 # Dockerfile ve compose tanımları
  /scripts                # backup, restore, health-check
```

Monorepo için pnpm workspace kullanılabilir. Paketler arasında mobil/web görsel bileşenlerini zorla paylaşma; domain tipleri, şema ve tasarım token'ları paylaşılabilir.

## Backend modülleri
- `auth`: oturum, parola, refresh token rotasyonu
- `users`: kullanıcı ve profil yönetimi
- `organization`: firma/kurulum ayarları (tek kuruluş)
- `projects`: proje ve şantiye/alan
- `tasks`: görevler, yorumlar, durum geçmişi
- `daily-reports`: günlük rapor ve revizyonlar
- `media`: dosya metadata ve güvenli yükleme
- `personnel`: personel kayıtları
- `attendance`: puantaj ve devam kayıtları
- `inventory`: depo, malzeme, stok hareketleri
- `expenses`: gider ve onay akışı
- `progress-claims`: sözleşme kalemleri ve hakediş dönemleri
- `reports`: rapor ve dışa aktarma
- `audit`: denetim kayıtları
- `sync`: mobil senkronizasyon uçları
- `system`: sağlık, ayar, yedekleme durumu

## Katmanlama
Her backend modülünde aşağıdaki ayrımı koru:
- Controller: HTTP giriş/çıkış, auth guard, DTO.
- Application/service: kullanım senaryosu ve transaction koordinasyonu.
- Domain: iş kuralı ve hesaplama.
- Repository/data access: Prisma sorguları.

İlk aşamada gereksiz soyutlama veya ağır DDD kurgusu kurma. İhtiyaç kadar modülerlik yeterlidir.

## API standardı
- Base path: `/api/v1`
- JSON REST; tarih/zaman ISO-8601 UTC.
- Liste uçlarında `page`, `pageSize`, `sort`, filtreler.
- Standart hata gövdesi: `code`, `message`, `details`, `traceId`.
- Swagger/OpenAPI her değişiklikte güncel tutulur.
- Idempotent mobil yazım isteklerinde `Idempotency-Key` veya `clientMutationId` kullanılır.

## Kimlik doğrulama
- Access token kısa ömürlü; refresh token döndürme/rotasyon ve iptal mekanizmalı.
- Mobil token'lar güvenli cihaz depolamasında saklanır.
- Web refresh/session cookie `HttpOnly`, `Secure`, uygun `SameSite` ayarıyla tutulur.
- Kullanıcı devre dışı bırakıldığında aktif refresh token'ları iptal edilir.

## Dosya depolama
Veritabanında yalnızca metadata ve storage key tutulur. API, yetki kontrolünden sonra kısa ömürlü imzalı upload/download URL üretir veya dosyayı proxy eder. Dosya boyutu, uzantı ve MIME kontrolü yapılır; mümkünse antivirüs taraması entegrasyon noktası bırakılır.

## Arka plan işleri
İlk kurulumda Redis zorunlu değildir. Bildirim, rapor üretimi ve dosya işleme gibi işler için DB outbox/job tablosuyla başlanabilir. Yük büyürse Redis/BullMQ opsiyonel olarak eklenir.

## Ortamlar
- `development`: yerel geliştirme
- `test`: otomatik test
- `staging`: sürüm öncesi müşteri benzeri test
- `production`: müşteri kurulumu

Gizli anahtarlar `.env` ile yönetilir; `.env` repoya eklenmez. `.env.example` yalnızca değişken adları ve örnek/değersiz değerler içerir.
