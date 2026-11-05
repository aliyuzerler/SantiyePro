# Faz 03 Test Raporu — Projeler ve Şantiyeler

- **Tarih:** 2026-11-05
- **Kapsam:** prompts/phase-03-development.md + prompts/phase-03-test.md
- **Sonuç:** ✅ TÜM TESTLER GEÇTİ — Faz 03 kapanmaya hazır

## 1. Uygulanan kapsam

| Madde (development promptu) | Durum | Not |
| --- | --- | --- |
| Project / Site / ProjectMember modelleri (migration) | ✅ | `20261105184806_projects_sites` — DECIMAL(18,2), DATE kolonları, FK'lar |
| Proje oluşturma/düzenleme (web + mobil) | ✅ | Web form + detay düzenleme; mobil form (project.edit izniyle) |
| Durum yönetimi | ✅ | Kurallı geçiş matrisi (contracts `canTransitionProjectStatus`), geçersiz geçiş 400 |
| Sorumlu atama | ✅ | managerId → otomatik MANAGER üyeliği; üyelikten çıkarsa sorumluluk boşalır |
| Proje üye yönetimi | ✅ | Ekleme/çıkarma/kapsam rolü değişimi + audit |
| Proje listesi + detay (web + mobil) | ✅ | Web tablo + detay; mobil kart + sekmeli detay (Genel/Şantiyeler/Üyeler) |
| Proje kodu kurulum içinde benzersiz | ✅ | DB unique + 409 CONFLICT |
| Kapsam: yalnızca erişim kapsamındaki projeler | ✅ | FIRM_ADMIN tümü; diğerleri yalnızca üye olduğu projeler; kapsam dışı 404 |
| Pasife alma bağlı kayıtları silmez | ✅ | Arşiv = status ARCHIVED; şantiye/üye satırları korunur (e2e doğrular) |
| Timezone-safe tarihler | ✅ | PostgreSQL DATE + `YYYY-MM-DD` sözleşmesi; kayma testi geçti |
| Liste API'sinde pagination/filtre/arama | ✅ | `page/pageSize/search/status/managerId/sort/order` |
| Silme yerine archive/soft-delete | ✅ | DELETE ucu yok; varsayılan liste arşivi gizler, filtreyle görünür |
| Aktif proje bağlamı görünür | ✅ | Web detay başlığı (kod+ad+durum kalıcı) + mobil bağlam kartı |
| Web tablo / mobil kart + sekmeli detay | ✅ | design/03 ve design/02 uyumlu |
| OpenAPI güncel | ✅ | `@ApiTags('projects')` + uç özetleri (`/api/v1/docs`) |
| Sentetik seed, sahte dashboard sayısı yok | ✅ | Dashboard dürüst boş durum; demo veri gerçek API akışlarıyla kuruldu |

## 2. Test sonuçları (prompts/phase-03-test.md eşlemesi)

**Toplam: 122 test — 122 geçti, 0 başarısız.**

| Paket | Tür | Sonuç |
| --- | --- | --- |
| `@santiyepro/contracts` | birim (token parity) | 1/1 ✅ |
| `@santiyepro/api` | birim | 10/10 ✅ |
| `@santiyepro/api` | **e2e (gerçek PostgreSQL)** | **37/37 ✅** (auth 14 + projects 16 + health 7) |
| `@santiyepro/web` | bileşen (jsdom) | 37/37 ✅ (7 yeni proje testi) |
| `@santiyepro/mobile` | bileşen (RNTL) | 37/37 ✅ (11 yeni proje testi) |

### Test promptu maddeleri → kanıt

1. **Proje oluşturma, düzenleme, arşivleme, benzersiz kod** → `projects.e2e-spec.ts`: oluşturma 201 + audit, mükerrer kod 409, doğrulama hataları 400, arşiv/reaktivasyon geçişleri ✅
2. **Site yalnızca doğru projeye bağlanıyor** → yanlış projeden şantiye güncelleme 404; `(projectId, name)` unique 409; aynı ad başka projede serbest ✅
3. **ProjectMember ekleme/çıkarma + kapsam** → 201/409/204 akışları, rol değişimi, audit kayıtları ✅
4. **IDOR** → PM kapsam dışı projede GET/PATCH/site-POST/members-GET → hepsi 404; işçi üye olduğu projede GET 200 ama yazma 403 ✅
5. **Filtre, arama, sıralama, pagination** → pageSize=2 ile 3 kayıt (total=3, totalPages=2), `search=köprü` ILIKE, `status=PLANNING/ACTIVE`, `sort=name&order=asc` ✅
6. **Tarih sınırları ve timezone** → `startDate <= plannedEndDate` zorunlu; `2026-02-05` gönder → `2026-02-05` dönüyor (DATE kolonu) ✅
7. **Web/mobil boş-loading-error-yetkisiz durumları** → LoadingSkeleton/EmptyState/ErrorState testleri; project.edit izni olmayana aksiyon çizilmez ✅
8. **Arşivlenen projenin bağlı verileri korunuyor** → arşiv sonrası site=1, member=1 (DB sayımı), detay erişilebilir ✅

### Kalite kapıları

| Kapı | contracts | api | web | mobile |
| --- | --- | --- | --- | --- |
| lint | ✅ | ✅ | ✅ | ✅ |
| typecheck | ✅ | ✅ | ✅ | ✅ |
| build | ✅ | ✅ | ✅ (route: `/projeler`, `/projeler/[id]`) | ✅ |

## 3. Manuel doğrulama

- `health-check.sh`: liveness + readiness (DB ok) → PASS
- `/api/v1/docs` Swagger: projects uçları listelendi
- Panel (agent-browser, gerçek API):
  - admin girişi → `/panel/projeler`: 3 proje, arama/durum/sırala filtreleri, sayfalama hazır
  - proje detayı: bağlam başlığı (kod+ad+durum), Genel Bilgiler, Şantiyeler (2) + ekleme, Üyeler (4) + rol değişimi/çıkarma
  - mobil viewport (390×844): liste düzgün kırılım
  - konsol/px hataları: yok
- Kapsam canlı doğrulama: PM kullanıcısı `GET /projects` → yalnızca üyesi olduğu 2 proje (3 değil) ✅
- Ekran görüntüleri: `docs/screenshots/faz03-panel-projeler.png`, `faz03-panel-detay.png`, `faz03-panel-mobil.png`

## 4. Bilinen sınırlar / notlar

- CI'da e2e'ler gerçek PG service container'ında koşar; e2e dosyaları aynı test DB'sini paylaştığı için `fileParallelism: false` eklendi (Faz 03).
- Proje listesi sıralaması DB collation'a bağlıdır (C); Türkçe collation istenirse migration'da `COLLATE "tr-TR-x-icu"` ayrı değerlendirilir.
- Mobilde üye rolü değiştirme UI'ı web paneline bırakıldı (mobilde ekleme/çıkarma var); design/02'deki saha senaryosu kapsamı dışında.
- Docker Compose healthcheck doğrulaması hâlâ müşteri makinesi görevi (Faz 00 notu).
