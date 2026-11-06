# Faz 09 Test Raporu — Offline-First Sync

- **Tarih:** 2026-11-06
- **Kapsam:** prompts/phase-09-development.md + prompts/phase-09-test.md (docs/09-offline-sync.md, docs/07, ADR-003)
- **Sonuç:** ✅ TÜM TESTLER GEÇTİ — Faz 09 kapanmaya hazır

## 1. Uygulanan kapsam

### Sunucu (API)

| Madde (development promptu) | Durum | Not |
| --- | --- | --- |
| `POST /sync/push` | ✅ | Batch (1–50 mutation); her mutation için `accepted/rejected/conflict` + `serverId/version/error{code,message}`; dispatch gerçek servisler üzerinden (AttendanceService, TasksService, DailyReportsService, ExpensesService, StockService) — RBAC + kapsam + audit log fabrika kurallarıyla birebir |
| Her mutation clientMutationId ile idempotent | ✅ | Yeni `SyncMutationLog` tablosu `(userId, clientMutationId) unique`: işlenen mutation'ın sonucu `resultJson`'da saklanır; tekrar gönderim mutation'ı YENİDEN ÇALIŞTIRMADAN aynı sonucu `replayed: true` döner (yarışta unique-çakışması → defterden okuma) |
| Push sonucu accepted/rejected/conflict + açıklama | ✅ | ZodError → `VALIDATION_ERROR` (kalıcı); BadRequest/NotFound/Forbidden → kalıcı red; ConflictException → `conflict` (kritik kayıt otomatik üzerine YAZILMAZ); 5xx → `INTERNAL_ERROR` GEÇİCİ: deftere yazılmaz, istemci backoff ile yeniden dener |
| `GET /sync/pull` cursor/sequence delta | ✅ | Yeni `SyncEvent` tablosu (`seq BigInt @id autoincrement`): append-only değişiklik işaretçisi; pull, `seq > cursor` olaylarını entity başına EN YENİYE sıkıştırır ve HER ZAMAN güncel anlık görüntüyü okur (5 güncelleme → tek upsert); hard-delete → tombstone (`operation: delete`) |
| Yetkisiz/erişilemeyen proje verisi gönderilmez | ✅ | Pull kapsamı: FIRM_ADMIN kurum geneli, diğer roller üyelik; kapsam dışı olayın verisi GÖNDERİLMEZ ama cursor yine ilerler; `accessibleProjectIds` snapshot'ı ile erişimi kalkan proje cihaza bildirilir |
| Change logger yazma noktalarına bağlı | ✅ | `SyncEventsService` (global CommonModule): task (create/update/comment), dailyReport (create/update/submit/approve/reject/reopen), attendance (create/update/toplu — `updateManyAndReturn` ile değişen satırlar), personnel (create/update/deactivate), project (create/update/arşiv), site (create/update) |
| Çakışma politikası (docs/09) | ✅ | Stok/gider/puantaj duplicate → 409 → `conflict` (LWW yok); günlük raporda taslak olmayan kayda upsert push → `conflict` ("Rapor sunucuda 'SUBMITTED' durumunda…"); task.update version uyuşmazlığı → `conflict` |
| Mutation türleri | ✅ | `attendance.mark`, `task.update`, `task.comment`, `dailyReport.upsertDraft`, `expense.create`, `stock.movement` — her biri tür bazlı zod payload şemasıyla (contracts/sync.ts) doğrulanır |
| Swagger | ✅ | `/api/v1/docs` → `/sync/push`, `/sync/pull` belgelendi (canlı e2e doğrular) |

### Mobil (Expo)

| Madde | Durum | Not |
| --- | --- | --- |
| SQLite schema | ✅ | `expo-sqlite` (`santiyepro-sync.db`): `outbox` (clientMutationId PK, payload JSON, status, attemptCount, nextAttemptAt, lastError, errorCode, serverId, syncedAt), `local_entities` (entityType+entityId PK, projectId, data JSON), `media_queue` (localUri, targetReportId, localRef, projectId), `sync_meta` (cursor + lastSyncAt). Token/parola SQLite'a YAZILMAZ (SecureStore — docs/07) |
| Repository katmanı | ✅ | `SyncStorage` arayüzü: `SqliteSyncStorage` (gerçek cihaz) + `MemorySyncStorage` (jest/yedek); SQLite açılamazsa provider otomatik bellek içine düşer |
| Outbox app kapansa da sürer | ✅ | SQLite satırları; test: yeni motor + aynı depo → kayıt durur |
| Media queue | ✅ | Rapor metadata'sı ÖNCE outbox'a; fotoğraflar `localRef` ile rapor mutation'ına bağlanır; rapor kabul olunca motor `targetReportId` eşler; upload URL → PUT → complete → raporun güncel `mediaIds` listesine EKLEME (üzerine yazma yok); kesintide dosya URI yerelde kalır, retry aynı dosyadan |
| Sync cursor | ✅ | `sync_meta.sync_cursor`; pull sonrası ilerletilir, tekrar çekim boş delta döner |
| Connectivity observer | ✅ | `@react-native-community/netinfo` (dinamik import; testlerde injectable); online'a geçişte `syncNow`, AppState `active`'te `syncNow` |
| Exponential backoff + jitter | ✅ | `min(maxBackoff, base·2^(n−1)) + jitter(0..base)`; MAX_AUTO_ATTEMPTS=8'e ulaşan `failed` olur (kayıt durur); kullanıcı retry'ı sayaç sıfırlar |
| 401 güvenli refresh | ✅ | ApiError 401 → refresh BİR kez; başarılıysa aynı batch yeni tokenla; başarısızsa `authExpired` → login ekranı, outbox SQLite'ta AYNEN kalır |
| Sync status UI | ✅ | `SyncStatusBanner` (Çevrimdışı / Senkronizasyon bekliyor — X kayıt / Senkronize ediliyor / Güncel + son senkron / Çakışma-hata) Ana Sayfa'da, dokununca kuyruk ekranı; `SyncQueueScreen`: bekleyen/gönderilen/çakışma-hata sayaçları, kayıt listesi (durum, deneme, hata açıklaması, sonraki deneme), "Şimdi senkronize et", "Hatalıları yeniden dene", "Gönderilenleri temizle" (hatalılar asla silinmez), satır bazlı "Güvenli yeniden dene" |
| Öncelikli çevrimdışı akışlar | ✅ | Görev: durum değişimi + checklist (version ile — çakışmada conflict) + yorum; günlük rapor taslağı (fotoğraflarla birlikte); puantaj (Faz 06 kuyruğu korundu) — ağ hatasında outbox'a yazılır, "sunucu onayı bekliyor" bilgisi ekranlarda |
| Kritik hareketlerde idempotency + server validation | ✅ | Stok/gider/puantaj push'u sunucu doğrulamasından geçmeden `done` olmaz; kritik kayıtlar "Gönderildi" ancak sunucu onayıyla gösterilir |

## 2. Test sonuçları (prompts/phase-09-test.md eşlemesi)

**Toplam: 433 spec testi — 433 geçti, 0 başarısız + canlı Playwright 24 koşu (0 başarısız, 17 koşu mobil projede tasarım gereği atlandı).**

| Paket | Tür | Sonuç |
| --- | --- | --- |
| `@santiyepro/contracts` | birim | 83/83 ✅ |
| `@santiyepro/api` | birim | 17/17 ✅ |
| `@santiyepro/api` | **e2e (gerçek PostgreSQL)** | **170/170 ✅** (auth 17 + attendance 23 + daily-reports 11 + expenses 16 + progress-claims 16 + inventory 21 + media 12 + projects 16 + tasks 21 + health 5 + **sync 12 — yeni**) |
| `@santiyepro/web` | bileşen (jsdom) | 64/64 ✅ |
| `@santiyepro/mobile` | bileşen + birim (RNTL) | **99/99 ✅** (85 + **14 yeni sync-engine testi**) |
| `@santiyepro/web-e2e` | **Playwright canlı** | **24/24 ✅** (health ×2, kabuk ×3, mobil drawer ×2, görev ×3, rapor ×3, puantaj ×3, stok ×1, gider ×1 + hakediş ×1, **sync ×3 — yeni**) |

### Test promptu senaryoları → kanıt

1. **İnternet yokken kayıt; force-close → açılışta kayıt duruyor mu?** → mobil `sync-engine.test.ts`: "kayıt kuyruğa alınır; motor yeniden kurulsu da kayıt depoda durur" (yeni motor + aynı depo = app restart); SQLite'ta `outbox` tablosu kalıcıdır ✅
2. **Bağlantı gelince push/pull tamamlanıyor mu?** → "bağlantı gelince flush tüm bekleyenleri gönderir ve done işaretler" (mobil) + api e2e "push edilen görev yorumu pull deltasında seq sırasıyla gelir; cursor ilerler" + Playwright canlı push→pull ✅
3. **Aynı mutation 3 kez → tek kayıt mı?** → mobil "aynı clientMutationId üç kez eklenirse TEK push"; api e2e "3 kez gönderilen puantaj tek kayıt oluşturur, replayed döner" (DB count=1); Playwright canlı ×3 → `serverId` sabit, `/attendance`'ta tek kayıt ✅
4. **401 / 403 / 409 / 422 / 500 / timeout davranışı** → 401: mobil refresh-bir-kez + refresh-fail→authExpired+outbox-korunur testleri; 409: api e2e stale-version conflict + submit edilmiş rapora taslak push conflict; 422/400: "bilinmeyen tür 400", "geçersiz yük rejected"; 500: ApiError 500 → geçici + backoff (mobil); timeout: `requestTimeoutMs` sentetik hata → backoff (mobil); 403: REST RBAC uçları mevcut attendance/expenses e2e'lerinde kapsamlı, push'ta Forbidden → kalıcı red ✅
5. **Fotoğraf upload ortasında kesinti → dosya kaybolmadan retry** → mobil "rapor kabul olunca bağlı medya satırı sunucu raporuna eşlenir (dosya URI yerelde kalır)"; `media-flush.ts` kesintide satır pending/failed kalır, `localUri` dokunulmaz; MAX_MEDIA_ATTEMPTS=5 ✅
6. **İki cihazda aynı rapor değişirse conflict gösteriliyor mu?** → api e2e "gönderilmiş rapora çevrimdışı taslak push edilirse conflict döner; içerik değişmez" + mobil conflict durumu kuyruk ekranında görünür (`conflictCount`, hata açıklaması) ✅
7. **Kritik stok server onayı olmadan kesin bakiye gibi gösterilmiyor mu?** → push kabul edilene dek outbox `pending` ve bandırada "Senkronizasyon bekliyor"; rejected stok hareketi sunucu doğrulamasıyla reddedilir (api e2e + Playwright); geçici hatada "Bağlantı yok — kayıtlar bu cihazda saklanıyor" ✅
8. **Silinen/erişimi kaldırılan proje verisi pull'da temizleniyor mu?** → api e2e "üyelik kaldırılınca accessibleProjectIds projeyi düşürür" + mobil "pull değişiklikleri local_entities'e yazar… erişimi kalkan proje temizlenir" (`clearProjectEntities`) + "pull tombstone satırı yerel entity'yi siler" ✅
9. **Cihaz saati yanlış olduğunda sıralama server cursor/version ile tutarlı mı?** → api e2e "localCreatedAt saçma değerlerle gelirse pull sıralaması sunucu seq'ine göre kurulur" (2030/1999 saatleriyle push sırası korunur); `SyncEvent.seq` monotonik, cihaz saati sıralamaya katılmaz ✅
10. **Outbox başarısız mutation'ı sessizce silmiyor mu?** → mobil "VALIDATION_ERROR rejected… otomatik tekrar denenmez" (kayıt + açıklama durur, ikinci sync push'a girmez), "deneme hakkı biten kayıt failed olur ama SİLİNMEZ"; api e2e "geçersiz gider… tekrarı aynı sonucu replayed ile döndürür" (SyncMutationLog kalıcı) ✅

## 3. Kalite kapıları

| Kapı | Sonuç |
| --- | --- |
| `pnpm test` (contracts/api/web/mobile birim) | ✅ 263/263 |
| `api test:e2e` (gerçek PostgreSQL, 5433) | ✅ 170/170 |
| `lint` (4 paket) | ✅ 0 hata |
| `typecheck` (4 paket) | ✅ 0 hata |
| `build` (contracts/api/web; mobil paket build'siz — expo bundle üretim adımı) | ✅ |
| `pnpm e2e` — Playwright canlı (gerçek API dist + PostgreSQL + panel) | ✅ 24/24 |

## 4. Ekran görüntüleri

Faz 09 ürün yüzü mobil uygulama ve API'dir; panel'de yeni ekran yoktur. Mobil ekranlar (SyncStatusBanner, SyncQueueScreen) jest-expo render testleriyle doğrulanır; sandbox'ta cihaz emülatörü bulunmadığından ekran görüntüsü üretilmemiştir. API sözleşme yüzeyi canlı e2e'de `/api/v1/docs` üzerinden doğrulanmıştır (önceki fazın `docs/screenshots/api-swagger.png` referansı geçerlidir).

## 5. Sonuç

Faz 09 tüm geliştirme maddelerini ve 10 test senaryosunu gerçek API + gerçek PostgreSQL üzerinde karşılar; veri kaybı veya duplicate işlem saptanmamıştır. Faz 10'a (raporlar, denetim görünümleri, yedekleme) geçilebilir.
