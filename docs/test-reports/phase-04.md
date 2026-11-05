# Faz 04 Test Raporu — Görev Yönetimi

- **Tarih:** 2026-11-05
- **Kapsam:** prompts/phase-04-development.md + prompts/phase-04-test.md
- **Sonuç:** ✅ TÜM TESTLER GEÇTİ — Faz 04 kapanmaya hazır

## 0. Bu fazda ayrıca: Canlı Test Standardı yürürlüğe girdi

Faz 03 kapanışının ardından **Playwright canlı E2E standardı** kurumsallaştırıldı
(`docs/process/canli-test-standardi.md`, `apps/web-e2e` paketi, kök `pnpm e2e`).
Standardın ilk uygulaması bu fazdır: **her faz kapanmadan ürün gerçek API + gerçek
PostgreSQL + gerçek tarayıcı üzerinde uçtan uca doğrulanır.**

> Standart kurulurken canlı koşum **gerçek bir hata yakaladı**: tam sayfa
> yenilemesinde oturum düşüyordu (StrictMode çift boot / ikinci sekme, rotate
> edilmiş refresh cookie ile istek atınca reuse tespiti aileyi iptal ediyordu).
> Düzeltme: API tarafında 60 sn eşzamanlılık grace penceresi + web'de
> single-flight refresh. Düzeltme öncesi keşif, düzelme sonrası 12/12 canlı koşum.

## 1. Uygulanan kapsam

| Madde (development promptu) | Durum | Not |
| --- | --- | --- |
| Task / TaskComment / TaskStatusHistory modelleri + migration | ✅ | `20261105195246_tasks_module` — docs/04 index'leri `(projectId,status,dueAt)`, `(assigneeId,status)`; `version` iyimser eşzamanlılık |
| Görev oluşturma/düzenleme/atama | ✅ | Web formu + drawer, mobil detay; atama `task.assign` izni ister, hedef aktif **proje üyesi** olmalı |
| Öncelik | ✅ | LOW/MEDIUM/HIGH/CRITICAL + Türkçe rozetler (color-blind safe) |
| Termin (dueAt) | ✅ | Timezone'lu ISO 8601; ofsetli giriş UTC'ye normalize; geçmiş termin listede **Gecikmiş** rozeti |
| Checklist | ✅ | Json kolon, tam liste değişimi, sunucuda id üretimi (oluşturma), done işaretleme |
| Yorum | ✅ | `/tasks/:id/comments` GET+POST; kapsam içindeki her üye yorum yazar |
| Ek dosya referansı | ✅ | `fileRefs` Json kolonu (id/name/mimeType/sizeBytes); medya modülü sonraki fazlarda bağlanır |
| Durum akışı kurallı | ✅ | TODO/IN_PROGRESS/BLOCKED/DONE/CANCELLED — contracts matrisi, geçersiz geçiş 400; DONE/CANCELLED terminal |
| Atanan kişi kendi durumunu değiştirebilir | ✅ | Saha akışı: task.edit'siz FIELD_WORKER kendi görevinde durum değiştirir, alan düzenleyemez |
| Proje kapsamı | ✅ | FIRM_ADMIN tümü; diğerleri yalnızca üye olduğu projenin görevleri; kapsam dışı 404 (IDOR) |
| Bildirim altyapısı event'i | ✅ | `Notification` tablosu + `task.assigned` event'i (kendine atamada üretilmez); push sağlayıcısı sonraki faz |
| Web: filtrelenmiş tablo + detay drawer | ✅ | arama/proje/durum/öncelik/gecikmiş filtreleri, sıralama, sayfalama; drawer: durum butonları, checklist, yorum, geçmiş |
| Mobil: Bana Atananlar / Proje Görevleri + detay | ✅ | Sekmeli liste (assigneeId=me / proje seçimi), kartlarda gecikme rozeti, detay ekranı |
| Durum değişiklikleri audit/history | ✅ | `task.created/updated/status_changed/commented` audit + autoincrement id ile katı geçmiş sırası |
| Arşivlenmiş projeye görev eklenemez | ✅ | 400 VALIDATION_ERROR |

## 2. Test sonuçları (prompts/phase-04-test.md eşlemesi)

**Toplam: 175 test — 175 geçti, 0 başarısız + canlı Playwright 12/12.**

| Paket | Tür | Sonuç |
| --- | --- | --- |
| `@santiyepro/contracts` | birim | 18/18 ✅ (durum makinesi, isTaskOverdue, şemalar, izin matrisi) |
| `@santiyepro/api` | birim | 10/10 ✅ |
| `@santiyepro/api` | **e2e (gerçek PostgreSQL)** | **59/59 ✅** (auth 17 + tasks 21 + projects 16 + health 5) |
| `@santiyepro/web` | bileşen (jsdom) | 44/44 ✅ (7 yeni görev testi) |
| `@santiyepro/mobile` | bileşen (RNTL) | 44/44 ✅ (7 yeni görev testi) |
| `@santiyepro/web-e2e` | **Playwright canlı** | **12/12 ✅** (health ×2 proj, kabuk ×3, mobil drawer ×2, Faz 04 kritik akış ×3 desktop) |

### Test promptu maddeleri → kanıt

1. **CRUD ve zorunlu alan validasyonu** → kısa başlık/bozuk dueAt (`30.06.2030`, `2030-06-30`)/geçersiz öncelik/projesiz → 400; geçerli oluşturma 201 + ilk geçmiş kaydı `null→TODO` ✅
2. **Geçerli/geçersiz durum geçişleri** → TODO→DONE 400; TODO→IN_PROGRESS→DONE zinciri + completedAt; DONE→TODO/CANCELLED 400 (terminal) ✅
3. **Proje scope ve assignee yetkisi** → işçi oluşturamaz 403; teknik ofis atayamaz 403 ("sınırlı" hücresi) ama atamadan oluşturur; üye olmayana atama 400; işçi kendi görevinin durumunu değiştirir (200) ama başlığını düzenleyemez (403) ✅
4. **IDOR** → PM başka projenin görevine GET/PATCH/comment → 404 (varlık sızdırılmaz) ✅
5. **Checklist ve yorum kaydı** → tam liste değişimi + DB Json doğrulaması; yorum 201 + commentCount/audit ✅
6. **Status history sırası** → 5 adımlı zincir (`null→TODO→IN_PROGRESS→BLOCKED→IN_PROGRESS→DONE`) autoincrement id sırasıyla; audit kayıtları ✅
7. **Due date/timezone sınırları** → ISO 8601 saklama + `+03:00` ofset → UTC normalize; geçmiş termin `overdue=true` filtresi + DTO bayrağı; DONE sonrası gecikme kalkar ✅
8. **Sayfalama/filtreleme + mobil boş/hata durumları** → search/status/priority/overdue/sort + pagination meta; mobil EmptyState ("Sana atanan görev yok") ve ErrorState + Tekrar dene ✅
9. **Web kritik akış E2E (Playwright, canlı)** → UI girişi → /panel/gorevler → arama → drawer → durum değiştirme (TODO→Devam Ediyor) → geçmiş görünür → yorum eklenir; ekran görüntüleri `docs/screenshots/faz04-*.png` ✅
10. **Mobil kritik akış E2E (RNTL)** → kart → detay → "Devam Ediyor" → PATCH gövdesi + geçmiş satırı; checklist işaretleme PATCH'i; yorum POST gövdesi ✅

### Kalite kapıları

| Kapı | contracts | api | web | mobile | web-e2e |
| --- | --- | --- | --- | --- | --- |
| lint | ✅ | ✅ | ✅ | ✅ | (n/a) |
| typecheck | ✅ | ✅ | ✅ | ✅ | ✅ |
| build | ✅ | ✅ | ✅ (route: `/gorevler`) | ✅ | — |

## 3. Manuel doğrulama (canlı)

- `pnpm e2e` — Playwright gerçek ortamda: **12 koşu geçti** (gerçek API + gerçek PG + panel dev sunucusu)
  - API sağlık: liveness + readiness (gerçek DB)
  - Panel kabuğu: gerçek UI girişi → 11 modül sayfası (masaüstü 1440×900); mobil 390×844 drawer aç/kapat/navigate
  - Faz 04 kritik akış: görev oluştur (API) → listede ara → drawer'da durum değiştir → geçmiş + yorum
- Ekran görüntüleri: `docs/screenshots/faz04-panel-gorevler.png`, `faz04-panel-gorev-detay.png`
- `/api/v1/docs` Swagger: `tasks` uçları listelendi

## 4. Bilinen sınırlar / notlar

- Checklist/dosya referansı güncellemeleri tam liste değişimlidir; item-level operasyon offline-sync (Faz 09) ile değerlendirilir.
- Mobilde görev **oluşturma** formu yok (kapsam: liste + detay + durum); oluşturma web panelinde.
- Bildirim olayları `Notification` tablosuna yazılır; okundu/okunmadı uçları ve push sağlayıcısı sonraki fazlarda.
- Görev silme yoktur (MVP): CANCELLED terminal durumdur.
- E2e temizlik zincirine Faz 04 tabloları eklendi (auth/projects spec'leri de `notification → taskStatusHistory → taskComment → task` sırasıyla temizler; `createdById` FK Restrict).
