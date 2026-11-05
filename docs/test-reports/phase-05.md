# Faz 05 Test Raporu — Günlük Şantiye Raporu ve Medya

- **Tarih:** 2026-11-05
- **Kapsam:** prompts/phase-05-development.md + prompts/phase-05-test.md
- **Sonuç:** ✅ TÜM TESTLER GEÇTİ — Faz 05 kapanmaya hazır

## 1. Uygulanan kapsam

| Madde (development promptu) | Durum | Not |
| --- | --- | --- |
| DailyReport / DailyReportRevision / DailyReportWorker / DailyReportMedia / MediaFile modelleri | ✅ | Migration `20261105202234_daily_reports_media`; index'ler docs/04 uyumlu |
| Rapor alanları | ✅ | proje/şantiye, tarih (DATE), hava durumu, yapılan işler (zorunlu), ekip özeti + satırları, ekipman, sorun/gecikme, İSG notu, ertesi gün planı, ekler |
| Taslak → gönder → onayla/reddet akışı | ✅ | contracts matrisi: DRAFT→SUBMITTED→APPROVED/REJECTED; REJECTED→DRAFT (reopen) + REJECTED→SUBMITTED (doğrudan yeniden gönderim — belgelenmiş MVP kararı) |
| Onaylı/gönderilmiş rapor düzenlenince revizyon | ✅ | Önceki içerik tam snapshot + SHA-256 hash, append-only `DailyReportRevision`; revisionNo artar; DRAFT/REJECTED düzenlemesi snapshot üretmez |
| Web: liste + detay + fotoğraf galerisi + revizyon geçmişi | ✅ | Filtreler (proje/durum/tarih aralığı), detay sayfası: galeri (imzalı URL), ekip tablosu, onay/red gerekçeli diyalog, revizyon snapshot görüntüleyici |
| Mobil öncelikli rapor formu | ✅ | design/02 §4 bölümleri: proje/şantiye chip'leri, tüm alanlar, ekip satırları, fotoğraf seçici (expo-image-picker, `exif:false`), `+ Kayıt` menüsünden açılır |
| Medya güvenliği: allowlist MIME/size | ✅ | jpeg/png/webp/pdf; SVG ve executable yasak; 10 MB üst sınır; sunucu tarafı doğrulama |
| Server-generated storage key | ✅ | `{projectId}/{yyyyMM}/{uuid}.ext` — kullanıcı girdisi yok; resolve'ta segment segment doğrulama (path traversal kapalı); storageKey DTO'da ASLA yok |
| Signed URL | ✅ | HMAC-SHA256(id.action.exp), varsayılan 10 dk; write (PUT) ve read (GET) ayrı imza; kurcalama/süre aşımı/başka id → 403 |
| Ownership check + private bucket | ✅ | Medya proje kapsamıyla 404 (varlık sızdırılmaz); tamamlama yalnızca yükleyen/admin; dosyalar API kökü altında private `.media-storage/` (gitignore) |
| EXIF GPS politikası | ✅ | Ürün kararı: JPEG APP1+ (EXIF/XMP) ve PNG eXIf chunk'ları sunucuda tamamen soyulur; APP0 (JFIF) ve piksel verisi korunur; PDF/WebP soyulmaz (belgelenmiş) |
| Thumbnail | 📋 Planlandı | `scanStatus` + storage key yapısı hazır; üretim için image pipeline (Faz 10 kurulum/servis katmanı) — bu fazda saf-Node decode bağımlılığı eklenmedi |
| Fotoğraf yükleme başarısızsa metin korunumu | ✅ | Form ÖNCE taslağı kaydeder; fotoğraflar SONRA yüklenir; başarısız dosya `OfflineMediaQueue`'ya girer, uyarı gösterilir (web + mobil testlerle kanıtlı) |
| Offline medya kuyruğu temel veri yapısı | ✅ | `offline-media-queue.ts`: docs/09 alanları (clientMutationId, localUri, hedef ilişki, status, attemptCount), PersistenceAdapter arayüzü, retryable/clearDone — tam sync Faz 09 |
| OpenAPI güncel | ✅ | `@ApiTags('media' / 'daily-reports')` + uç özetleri |

## 2. Test sonuçları (prompts/phase-05-test.md eşlemesi)

**Toplam: 228 test — 228 geçti, 0 başarısız + canlı Playwright 15/15.**

| Paket | Tür | Sonuç |
| --- | --- | --- |
| `@santiyepro/contracts` | birim | 27/27 ✅ (rapor durum makinesi, saat sınırı, medya allowlist, path traversal dosya adı) |
| `@santiyepro/api` | birim | 17/17 ✅ (**7 yeni: JPEG APP1 strip, PNG eXIf strip, magic sniff, imzalı URL tampering/süre**) |
| `@santiyepro/api` | **e2e (gerçek PostgreSQL)** | **82/82 ✅** (auth 17 + tasks 21 + **daily-reports 11 + media 12** + projects 16 + health 5) |
| `@santiyepro/web` | bileşen (jsdom) | 50/50 ✅ (6 yeni: liste, filtre sorgusu, yetkisiz durum, detay, **imzalı galeri URL çözümü**, onay POST) |
| `@santiyepro/mobile` | bileşen (RNTL) | 52/52 ✅ (8 yeni: **kuyruk veri yapısı 5** + form 3: kritik akış, proje seçimi, metin korunumu) |
| `@santiyepro/web-e2e` | **Playwright canlı** | **15/15 ✅** (health ×2 proj, kabuk ×3, mobil drawer ×2, görev ×3, **rapor ×3: filtre+detay, galeri imzalı indirme, onay→düzenle→revizyon**) |

### Test promptu maddeleri → kanıt

1. **Taslak oluşturma/güncelleme/gönderme/onay/red** → `daily-reports.e2e`: DRAFT 201, submit/approve/reject akışları + audit; APPROVED terminal (tekrar submit/reject 400); DRAFT→APPROVED 400 ✅
2. **Onay sonrası revizyon ve eski içeriğin korunması** → APPROVED rapor 2 kez düzenlenir: revisionNo 0→1→2, snapshot.workSummary eski metinler, SHA-256 hash, sıra [1,0]; DRAFT düzenlemesi snapshot üretmez ✅
3. **Yetkisiz proje raporuna erişim** → şef kapsam dışı projede create/get/patch 404 (IDOR); approve için PM 404, şef 403 (izin katmanı) ✅
4. **MIME spoofing / aşırı boyut / path traversal / sahte media id** → PNG diye JPEG içeriği 400 + FLAGGED; MZ (executable) 400; SVG/oversize/traversal dosya adı 400; akış sırasında 413; sahte id download-url 404 ✅
5. **Signed URL süresi ve erişim kontrolü** → imzasız PUT 403; kurcalanmış imza 403; **geçmiş exp + geçerli HMAC 403** (manuel imzayla); başka id imzası 403; imzasız içerik GET 403 ✅
6. **EXIF GPS politikası** → GPS'li sahte EXIF'li JPEG/PNG yüklenir; depolanan baytlarda `GPS`/`Exif`/`eXIf` YOK; JFIF + tarama verisi korunur; birim testlerde segment düzeyi kanıt ✅
7. **Fotoğraf upload başarısızlığında metin korunumu** → API: sahte mediaId PATCH 400 → içerik bozulmaz; mobil: upload mock hatası → kuyruğa alınır + uyarı + taslak metni sunucuda; web: upload uyarısı + taslak korunur ✅
8. **Görsel thumbnail ve galeri performansı** → galeri `Content-Length` + `Cache-Control: private, max-age=600` ile servis edilir; thumbnail üretimi planlandı (bakınız kapsam tablosu) — belgelenmiş sınırlar
9. **Web/mobil loading, empty, error ve offline form davranışı** → web LoadingSkeleton/EmptyState/ErrorState testleri; mobil EmptyState ("Sana atanan görev yok" benzeri dürüst boş durumlar) + hata durumları; offline form: kuyruk + uyarı + taslak ✅

### Kalite kapıları

| Kapı | contracts | api | web | mobile | web-e2e |
| --- | --- | --- | --- | --- | --- |
| lint | ✅ | ✅ | ✅ | ✅ | (n/a) |
| typecheck | ✅ | ✅ | ✅ | ✅ | ✅ |
| build | ✅ | ✅ | ✅ (route: `/gunluk-raporlar`, `/gunluk-raporlar/yeni`, `/gunluk-raporlar/[id]`) | ✅ | — |

## 3. Manuel doğrulama (canlı — Playwright standardı)

- `pnpm e2e` — gerçek API + gerçek PostgreSQL + panel dev sunucusu: **15 koşu geçti**
  - Faz 05 kritik akış: API ile PNG yükleme (upload-url → imzalı PUT → complete) → UI girişi → rapor listesi filtre → detay → **galeri `<img>` imzalı URL'den gerçek PNG indirdi** (content-type doğrulandı) → Onayla → Düzenle → **Revizyon Geçmişi (1)** göründü
- Ekran görüntüleri: `docs/screenshots/faz05-panel-raporlar.png`, `faz05-panel-rapor-detay.png` (Onaylandı + ekip tablosu + galeri + revizyon 1)
- Bu fazda canlı koşumların bulduğu operasyonel sorun ve çözümü: tekrarlanan e2e koşumları login rate limit'ini (5/15dk) dolduruyordu → limitler env ile yapılandırılabilir yapıldı (`AUTH_LOGIN_EMAIL_RATE_LIMIT` / `AUTH_LOGIN_IP_RATE_LIMIT`), üretim varsayılanları korundu, auth e2e üretim değerine sabitlendi

## 4. Bilinen sınırlar / notlar

- **Thumbnail üretimi** bu fazda implement edilmedi: saf-Node image decode bağımlılığı eklemek yerine storage key + scanStatus altyapısı hazır bırakıldı; image pipeline Faz 10'da (kurulum/servis katmanı) değerlendirilecek. Galeri şu an orijinal baytları imzalı URL ile sunar.
- **WebP/PDF için metadata soyma** uygulanmaz (JPEG APP1/PNG eXIf soyulur); JPEG/PNG kamera kaynaklı GPS riskini karşılar — karar kodda ve raporda belgelidir.
- **Offline medya kuyruğu** veri yapısı + durum makinesi hazırdır; kalıcı adaptör (dosya/SQLite) ve otomatik yeniden yükleme Faz 09 sync ile gelir. Mobil formdan fotoğraf yükleme expo-image-picker + expo-file-system (`File.upload`, SDK 58 yeni API) ile gerçekleştirilir.
- REJECTED→SUBMITTED doğrudan yeniden gönderim, docs/05 akışına ek MVP kararıdır (şefin zorunlu draft turu atlaması); REJECTED→DRAFT da desteklenir (reopen ucu).
- E2e temizlik zinciri ortaklaştırıldı (`test/helpers/db-reset.ts`) — yeni tablolar tek yerden yönetilir.
