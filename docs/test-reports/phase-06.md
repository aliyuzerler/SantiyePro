# Faz 06 Test Raporu — Personel ve Puantaj

- **Tarih:** 2026-11-05
- **Kapsam:** prompts/phase-06-development.md + prompts/phase-06-test.md
- **Sonuç:** ✅ TÜM TESTLER GEÇTİ — Faz 06 kapanmaya hazır

## 1. Uygulanan kapsam

| Madde (development promptu) | Durum | Not |
| --- | --- | --- |
| Personnel / AttendanceRecord modelleri | ✅ | Migration `20261105211956_phase06_personnel_attendance`; Personnel alanları: employeeCode (unique), fullName, phone, jobTitle, companyOrSubcontractor, status; Attendance: proje/şantiye, workDate (DATE), vardiya anahtarı, durum, giriş-çıkış, workedMinutes, not, recordedBy, source, clientMutationId |
| Devam durumları: 6 varsayılan + kurum ayarıyla genişletilebilir | ✅ | PRESENT/HALF_DAY/ABSENT/LEAVE/SICK/HOLIDAY varsayılan; `OrgSettings` singleton (attendanceCustomStatuses) + `GET /attendance/statuses` birleşik listeyi döner; PATCH `/org/settings` yalnızca FIRM_SETTINGS_MANAGE; anahtar biçimi (BÜYÜK HARF) + varsayılan çakışma denetimi contracts'ta |
| Toplu işaretleme önizleme + onay | ✅ | `POST /attendance/bulk/preview` (yazma yok, satır satır CREATE/UPDATE/SKIP planı) → `POST /attendance/bulk` (confirm: true zod ile zorunlu; SKIP_* satırlarına dokunulmaz); web'de ConfirmDialog ile önizleme listesi + özet satırı |
| Duplicate engeli: aynı personel/proje/tarih/vardiya | ✅ | DB unique `(personnelId, projectId, workDate, shiftKey)` + servis ön kontrolü → 409 CONFLICT; eşzamanlı istekte P2002 yakalanır, aynı 409 zarfı; farklı vardiya aynı gün ayrı kayıt |
| Web: personel yönetimi + puantaj tablosu | ✅ | `/panel/puantaj`: Günlük Puantaj sekmesi (proje+gün+vardiya sayfası, satır bazlı durum çipleri, giriş/çıkış, süre, özet kartı) + Personel Kayıtları sekmesi (arama, durum filtresi, ekleme/düzenleme/pasife alma onay diyaloğu) |
| Mobil: hızlı personel arama + satır bazlı işaretleme | ✅ | `AttendanceScreen`: proje çipleri, gecikmeli arama, satır başına 6+ durum çipi (44dp), `+ Kayıt → Puantaj` menüsünden açılır; kayıt idempotent clientMutationId ile gönderilir |
| GPS varsayılan kapalı; sürekli konum toplama yok | ✅ | Şema/DTO/ekranlarda konum alanı YOK; mobil ekranda "GPS/konum istenmez" bilgilendirmesi; canlı E2E konum izni metni bulunmadığını doğrular |
| Personel verisi yetki scope'una göre | ✅ | attendance.view/edit PermissionsGuard'da (deny-by-default); puantaj kayıtları proje üyeliğiyle 404 (IDOR); personel listesi org-wide ama yalnızca attendance.view sahiplerine; pasif personele yeni kayıt 400 |
| Audit log | ✅ | personnel.created/updated/deactivated, attendance.created/updated/bulk_marked, org.settings.updated — maskelenmiş before/after |

## 2. Test sonuçları (prompts/phase-06-test.md eşlemesi)

**Toplam: 273 test — 273 geçti, 0 başarısız + canlı Playwright 18 koşu (0 başarısız).**

| Paket | Tür | Sonuç |
| --- | --- | --- |
| `@santiyepro/contracts` | birim | 37/37 ✅ (**10 yeni: durum birleştirme, workDate biçimi, durum-saat validasyonu, workedMinutes hesabı, bulk confirm zorunluluğu, org ayarı çakışma denetimi**) |
| `@santiyepro/api` | birim | 17/17 ✅ |
| `@santiyepro/api` | **e2e (gerçek PostgreSQL)** | **105/105 ✅** (auth 17 + **attendance 23** + daily-reports 11 + media 12 + projects 16 + tasks 21 + health 5) |
| `@santiyepro/web` | bileşen (jsdom) | 50/50 ✅ |
| `@santiyepro/mobile` | bileşen (RNTL) | 64/64 ✅ (**12 yeni: çevrimdışı puantaj kuyruğu 9** — duplicate koruması, yerel çakışma, flush/deneme sayacı, hydrate — **+ ekran 3**) |
| `@santiyepro/web-e2e` | **Playwright canlı** | **18/18 ✅** (health ×2, kabuk ×3, mobil drawer ×2, görev ×3, rapor ×3, **puantaj ×3: satır işaretleme, toplu önizleme+onay, personel oluşturma**) |

### Test promptu maddeleri → kanıt

1. **Personel CRUD ve pasife alma** → `attendance.e2e`: 201 oluşturma, alan validasyonu 400, sicil çakışması 409, arama/durum filtresi, PATCH status=PASSIVE (geçmiş korunur, detay hâlâ erişilebilir) ✅
2. **Her devam durumu ve giriş/çıkış validasyonu** → 6 varsayılan durumla kayıt 201; ABSENT/LEAVE/SICK/HOLIDAY'de checkIn/checkOut/workedMinutes 400; checkOut ≤ checkIn 400; her iki saat girilince workedMinutes hesaplanır (540 dk); PRESENT/HALF_DAY saat kabul eder ✅
3. **Duplicate engeli** → aynı personel/proje/tarih/vardiya 409 (CONFLICT, details.existingRecordId); aynı gün GECE vardiyası ayrı 201; PATCH düzeltme yolu ✅
4. **Toplu işaretleme yanlış kişiye uygulanamaz; onay akışı** → confirm olmadan 400; önizleme yazma yapmaz (w3 kayıtsız kalır); pasif → SKIP_PASSIVE, bilinmeyen id → SKIP_NOT_FOUND, mevcut farklı durum → UPDATE; onayda yalnızca CREATE/UPDATE uygulanır, SKIP kişilere kayıt açılmaz ✅
5. **Proje scope ve hassas veri yetkisi** → PM kapsam dışı projeye yazamaz 404, listesi boş döner; TECH_OFFICE (view) görüntüler, yazamaz 403; FIELD_WORKER personel listesine 403; IDOR: kapsam dışı kayıt 404 ✅
6. **Tarih/timezone sınırları ve rapor özetleri** → workDate YYYY-MM-DD zorunlu (`20.06.2026` 400); DATE kolonu UTC takvim günü; `GET /attendance/summary`: byStatus adetleri, uniquePersonnelCount, totalWorkedMinutes, byDate dağılımı; ters aralık 400; 366 gün üst sınır ✅
7. **GPS izni istemeden konum toplanmıyor** → şema/DTO'da konum alanı yok (kod incelemesi + sözleşme testleri); canlı E2E puantaj ekranında konum izni metni/istemi yok ✅
8. **Mobil offline duplicate/local conflict koruması** → kuyruk testleri: aynı işaretleme ikinci kez kuyruğa girmez (wasDuplicate, orijinal mutasyon korunur); durum değişince son yazılan kazanır + hadConflict bayrağı; farklı vardiya ayrı kayıt; flush 409'u da done sayar; sunucu reddi deneme sayacını artırır; MAX'ta failed; hydrate kalıcılık ✅

### Kalite kapıları

| Kapı | contracts | api | web | mobile | web-e2e |
| --- | --- | --- | --- | --- | --- |
| lint | ✅ | ✅ | ✅ | ✅ | (n/a) |
| typecheck | ✅ | ✅ | ✅ | ✅ | ✅ |
| build | ✅ | ✅ | ✅ (route: `/puantaj`) | ✅ | — |

## 3. Manuel doğrulama (canlı — Playwright standardı)

- `pnpm --filter @santiyepro/web-e2e exec playwright test` — gerçek API + gerçek PostgreSQL + panel dev sunucusu: **18 koşu geçti, 14 koşu (mobil projesi) atlandı**
  - Faz 06 kritik akış: API ile proje + 3 personel kurulur → UI girişi → `/panel/puantaj` → proje seçimi → **satır bazlı "Tam Gün" işaretleme** (kayıt oluşur, özet güncellenir) → **toplu işaretleme**: 2 kişi seç → "Gelmedi" → Önizle diyaloğu (CREATE + UPDATE satır planı, "1 yeni kayıt · 1 güncelleme · 0 atlama") → Onayla → satır durumu güncellenir → **Personel Kayıtları** sekmesinde yeni personel oluşturma → listede görünür
- Ekran görüntüleri: `docs/screenshots/faz06-panel-puantaj.png`, `faz06-panel-toplu-onizleme.png`, `faz06-panel-personel.png`
- Canlı koşumların bulduğu gerçek sorunlar ve çözümleri:
  - Panelin proje/personel seçicileri 20 kayıtlık ilk sayfayı çekiyordu; e2e verisi birikince seçenek kayboluyordu → `projectsApi.list`/`personnelApi.list`'e `pageSize` parametresi eklendi, puantaj sayfası 100 kayıt çeker (varsayılanlar korunur)
  - Paylaşılan e2e DB'sinde Personnel→User Restrict FK'sı eski reset zincirini kırıyordu → `db-reset.ts` ve inline temizlik zincirleri attendance/personnel/orgSettings ile güncellendi

## 4. Bilinen sınırlar / notlar

- **Giriş-çıkış saatleri web'de yalnızca görüntülenir** (API alanları mevcut ve doğrulanmış); saat düzenleme arayüzü toplu işaretleme notu alanıyla birlikte Faz 10 dışa aktarma işleriyle birlikte değerlendirilebilir — bu faz kapsamı satır bazlı durum işaretlemesidir (prompt: "satır bazlı işaretleme").
- **Mobil tam çevrimdışı senkronizasyon** Faz 09'da gelir; bu fazda kuyruk veri yapısı + duplicate/çakışma koruması + flush mekanizması hazır ve testlidir (`offline-attendance-queue.ts`, kalıcı adaptör Faz 09).
- **Kuruma özel durum etiketleri** varsayılan 6 durum gibi renk tonlu rozetle değil nötr rozetle gösterilir (web tone haritası varsayılanları kapsar).
- E2e temizlik zincirine Faz 06 tabloları eklendi (`attendanceRecord`, `personnel`, `orgSettings` — Restrict FK'lar önce).
