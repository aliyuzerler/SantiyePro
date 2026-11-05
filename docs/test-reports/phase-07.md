# Faz 07 Test Raporu — Depo, Malzeme ve Stok Hareketleri

- **Tarih:** 2026-11-05
- **Kapsam:** prompts/phase-07-development.md + prompts/phase-07-test.md
- **Sonuç:** ✅ TÜM TESTLER GEÇTİ — Faz 07 kapanmaya hazır

## 1. Uygulanan kapsam

| Madde (development promptu) | Durum | Not |
| --- | --- | --- |
| Warehouse / Material / StockMovement / StockBalance modelleri | ✅ | Migration `20261105221744_phase07_inventory_stock`; Warehouse: projectId (null = kurum deposu), name, location, isActive; Material: code (nullable unique), name, category, unit, minStock DECIMAL(18,3), isActive; StockMovement: tip, miktar DECIMAL(18,3), unitCost DECIMAL(18,4), referenceType/Id, note, occurredAt, reversesMovementId (unique), clientMutationId (unique); StockBalance: (materialId, warehouseId) unique okuma modeli |
| Hareket append-only; eski hareket düzenlenmez/silinmez | ✅ | Hareket için PATCH/DELETE ucu YOKTUR (e2e: her ikisi de 404); düzeltme yalnızca ters kayıt ile; ters kayıt da append-only yeni kayıttır ve orijinali referanslar (`reversesMovementId`) |
| Transfer kaynak çıkış + hedef giriş tek DB transaction | ✅ | Tek hareket satırı (warehouseId kaynak, targetWarehouseId hedef); bakiye etkileri `movementDeltas`/`reverseDeltas` ile hesaplanır, `applyDeltasForMaterial` tek `$transaction` içinde uygulanır; yetersiz kaynak stokta throw → iki taraf da rollback (e2e doğrulu) |
| Eşzamanlı çıkışta negatif stok engeli | ✅ | Bakiye düşüşü koşullu atomik UPDATE: `UPDATE "StockBalance" SET quantity = quantity − q WHERE quantity >= q` — READ COMMITTED altında ikinci eşzamanlı istek predicate'i yeniden değerlendirir, 0 satır günceller → 409 CONFLICT; e2e: iki paralel 8'lik çıkış, 10'luk bakiyede sonuç [201, 409], final bakiye 2 |
| Birim uyumu doğrulanır | ✅ | İstekte `unit` verilirse malzeme birimiyle eşleşmek zorundadır: `unit=TON` + malzeme `TORBA` → 400 VALIDATION_ERROR |
| Miktar decimal hassasiyeti + açık yuvarlama politikası | ✅ | DECIMAL(18,3); API'de kanonik ondalık string; 3 basamaktan fazla ondalık girişi REDDEDİLİR (sessiz yuvarlama yok — `positiveQuantitySchema`/`signedQuantitySchema`); BigInt ölçekli (×1000) aritmetik (`parseQuantity`/`formatQuantity`) testlerle kilitli |
| Offline stok uyarı niteliğindedir; kesin kabul sunucudadır | ✅ | Mobil stok kartlarında "son bilinen bakiye" + "kesin kabul sunucu doğrulamasına bağlıdır" metni; negatif stok yerelde engellenmez, sunucu 409'u kuyrukta `done` sayılır (tekrar gönderilmez) |
| clientMutationId duplicate hareketi engeller | ✅ | DB unique + replay dönüşü (`replayed: true`, aynı hareket id); e2e: aynı anahtarla iki OUT → bakiye bir kez düşer |
| Aktör, zaman, proje/depo, açıklama, belge referansı | ✅ | Her harekette createdById, occurredAt, warehouse(+target), projectId, note, referenceType (PURCHASE/DAILY_REPORT/TASK/OTHER) + referenceId |
| Geçmiş filtrelenebilir ve denetlenebilir | ✅ | `GET /inventory/movements`: proje/depo/malzeme/tip/tarih aralığı/not arama filtreleri + sayfalama; filtresiz liste 400 (en az bir filtre zorunlu); tüm hareketler audit log'a yazılır |
| Stok kartında bakiye + son güncelleme zamanı | ✅ | `GET /inventory/balances`: quantity, minStock, `isLow` (kritik stok), `lastMovementAt`; web Stok Kartları sekmesinde kolon kolon, kritik stokta "Kritik Stok" rozeti |

## 2. Test sonuçları (prompts/phase-07-test.md eşlemesi)

**Toplam: 328 spec testi — 328 geçti, 0 başarısız + canlı Playwright 19 koşu (0 başarısız, 15 koşu mobil projede tasarım gereği atlandı).**

| Paket | Tür | Sonuç |
| --- | --- | --- |
| `@santiyepro/contracts` | birim | 57/57 ✅ (**20 yeni: ondalık aritmetik (parse/format/normalize/negate), 3 ondalık sınırı, işaretli ADJUSTMENT, tip bazlı bakiye etkileri, merge/reverse deltas, hareket istek şeması kuralları**) |
| `@santiyepro/api` | birim | 17/17 ✅ |
| `@santiyepro/api` | **e2e (gerçek PostgreSQL)** | **126/126 ✅** (auth 17 + attendance 23 + daily-reports 11 + **inventory 21** + media 12 + projects 16 + tasks 21 + health 5) |
| `@santiyepro/web` | bileşen (jsdom) | 54/54 ✅ (**4 yeni: hareket tipi tonları, işaret, tr-TR miktar biçimi, zaman biçimi**) |
| `@santiyepro/mobile` | bileşen (RNTL) | 74/74 ✅ (**10 yeni: çevrimdışı stok kuyruğu 8 — duplicate/çakışma koruması, flush, deneme sayacı, hydrate — + ekran 2**) |
| `@santiyepro/web-e2e` | **Playwright canlı** | **19/19 ✅** (health ×2, kabuk ×3, mobil drawer ×2, görev ×3, rapor ×3, puantaj ×3, **stok ×1 kritik akış**) |

### Test promptu maddeleri → kanıt

1. **Malzeme/depo CRUD, birim ve miktar validasyonu** → `inventory.e2e`: malzeme adı min 2 (400), minStock 4 ondalık 400; kod benzersiz 409; pasif malzemeye hareket 400; aynı kapsam aynı depo adı 409 ✅
2. **IN/OUT/TRANSFER/RETURN/ADJUSTMENT/REVERSAL iş kuralları** → IN +100.5 (unitCost'lu), OUT −0.5, birim uyumsuz 400; RETURN +2.5; ADJUSTMENT işaretli −0.25 (açıklamasız 400, bakiyeyi negatife çeken −500 → 409); TRANSFER iki bakiyeyi doğru günceller, kaynak=hedef 400, hedef yok 404; REVERSAL orijinali geri alır, ikinci ters kayıt 409, REVERSAL'ın ters kaydı 409; transfer ters kaydı yön değiştirir ✅
3. **Stoktan fazla çıkış engeli** → 50 birim stokta 50.001 çıkış → 409 CONFLICT, bakiye değişmez ✅
4. **İki eşzamanlı çıkışta negatif stok oluşmaması** → Promise.all ile iki 8'lik çıkış (bakiye 10) → [201, 409], final bakiye 2 (koşullu atomik UPDATE kanıtı) ✅
5. **Transferin atomikliği** → yetersiz kaynak stokta transfer → 409; hedef depoya yazılan artış da geri alınır (iki bakiye de değişmez) ✅
6. **Duplicate clientMutationId** → aynı anahtar iki istek: ikinci `replayed: true` + aynı hareket id; bakiye tek kez düşer ✅
7. **Geçmiş hareket silinemez/değiştirilemez** → PATCH ve DELETE `/inventory/movements/:id` → 404 (uç yok) ✅
8. **Project scope, depo yetkisi ve audit log** → FIELD_WORKER listeye 403; depocu (proje üyesi değil) proje deposunu listede görmez, hareketi 404; kapsam dışı proje filtresi boş liste (sızdırma yok); kurum deposunda hareket girebilir; audit log'da `stock.movement.created`, `warehouse.created`, `material.created` ✅
9. **Büyük listede pagination ve indeks** → 30 hareket 10'luk sayfalar (totalPages 3, sayfalar arasında tekrar yok); `(materialId, warehouseId, occurredAt)` / `(projectId, occurredAt)` / `(warehouseId, occurredAt)` indeksleri migration'da ✅

### Kalite kapıları

| Kapı | contracts | api | web | mobile | web-e2e |
| --- | --- | --- | --- | --- | --- |
| lint | ✅ | ✅ | ✅ | ✅ | (n/a) |
| typecheck | ✅ | ✅ | ✅ | ✅ | ✅ |
| build | ✅ | ✅ | ✅ (route: `/depo`) | ✅ | — |

## 3. Manuel doğrulama (canlı — Playwright standardı)

- `pnpm --filter @santiyepro/web-e2e exec playwright test` — gerçek API + gerçek PostgreSQL + panel dev sunucusu: **19 koşu geçti; 15 koşu kritik-akış spesleri masaüstü projesine sabit olduğundan mobil projede atlandı (standart davranış)**
  - Faz 07 kritik akış: API ile depo + malzeme kurulur → UI girişi → `/panel/depo` → **Depolar** sekmesinde depo görünür → **+ Stok Hareketi** diyaloğuyla **GİRİŞ 100** → Stok Kartları'nda `100 TORBA` → **ÇIKIŞ 30** → `70 TORBA` → Hareketler'de kayıtlar → **API düzeyinde 999'luk fazla çıkış → 409 CONFLICT** (UI'dan bağımsız sunucu kuralı) → bakiye 70'te kalır → **ÇIKIŞ hareketine ters kayıt** (gerekçe zorunlu) → bakiye `100 TORBA`'ya döner → listede **Ters Kayıt** rozeti
- Ekran görüntüleri: `docs/screenshots/phase-07-depo-depolar.png`, `phase-07-depo-stok-kartlari.png`, `phase-07-depo-hareketler.png`, `phase-07-depo-ters-kayit.png`
- `/panel/depo` önizlemesi (masaüstü 1440×900 + mobil 390×844) konsol hatasız render edilir.
- Canlı koşumların bulduğu gerçek sorunlar ve çözümleri:
  - Aynı dakika içinde girilen giriş/çıkış hareketleri aynı `occurredAt`'i alabiliyor; listeleme sıralaması eşitlikte id'ye dönüyor → canlı akışta ters kayıt hedefi "en yeni satır" yerine notla hedeflendi; **sunucu kuralı bu karışıklıkta da güvenli davrandı**: yanlışlıkla IN'e ters kayıt denemesi negatif bakiye üreteceği için 409 ile reddedildi (davranış e2e'de zaten kilitli).
  - Paylaşılan e2e DB'sinde StockMovement→User/Material/Warehouse Restrict FK'ları reset zincirini kırıyordu → `db-reset.ts` başına `stockMovement → stockBalance → material → warehouse` temizliği eklendi; inventory spec'i afterAll'da kendi verisini temizliyor.

## 4. Bilinen sınırlar / notlar

- **Stok bakiyesi okuma modelidir**: hareket kaydı asıl kaynaktır (docs/04). Bakiye yalnızca hareket transaction'ı içinde güncellenir; bağımsız "yeniden hesapla" ucu bu fazda yok — tutarsızlık riski transaction bütünlüğüyle kapanmıştır, gerektiğinde Faz 10 rapor fazında denetim aracı olarak eklenebilir.
- **Mobil tam çevrimdışı senkronizasyon** Faz 09'da gelir; bu fazda stok kuyruğu veri yapısı + duplicate/çakışma koruması + flush hazır ve testlidir (`offline-stock-queue.ts`, kalıcı adaptör Faz 09). Kuyruk anahtarı malzeme|depo|tip bileşimidir: aynı anahtar + aynı miktar duplicate sayılır, farklı miktar "son yazılan kazanır" ile değişir (`hadConflict` bayrağı).
- **Transfer satırı** tek kayıttır (kaynak + hedef kolonları); hareket geçmişinde "kaynak → hedef" biçiminde gösterilir.
- Web'de miktar girişleri tr-TR virgülünü kabul eder (`.replace(',', '.')`), API kanonik nokta-ondalık taşır; gösterim `formatQuantityTr` ile virgüllüdür.
- E2e temizlik zincirine Faz 07 tabloları eklendi (`stockMovement`, `stockBalance`, `material`, `warehouse` — Restrict FK'lar önce).
