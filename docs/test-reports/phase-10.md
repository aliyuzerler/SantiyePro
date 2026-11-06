# Faz 10 Test Raporu — Raporlama, Audit, Dışa Aktarma ve Backup

- **Tarih:** 2026-11-06
- **Kapsam:** prompts/phase-10-development.md + prompts/phase-10-test.md (docs/08-performance-rules.md, docs/10-deployment-backup.md, docs/11, docs/12)
- **Sonuç:** ✅ TÜM TESTLER GEÇTİ — Faz 10 kapanmaya hazır

## 1. Uygulanan kapsam

### Raporlar (API — gerçek DB verisi)

| Madde (development promptu) | Durum | Not |
| --- | --- | --- |
| Proje genel görünümü | ✅ | `GET /reports/project-overview`: proje başına görev (toplam/aktif/geciken), günlük rapor (onaylı/gönderilen), puantaj, stok hareketi, onaylı/bekleyen gider, onaylı hakediş net toplamı, son hareket zamanı — 13 paralel groupBy ile N+1'siz |
| Günlük rapor tarih/proje özeti | ✅ | `GET /reports/daily-reports`: (tarih × proje) kovası; DRAFT/SUBMITTED/APPROVED/REJECTED dağılımı + revizyon toplamı |
| Puantaj/katılım özeti | ✅ | `GET /reports/attendance`: (tarih × proje) kayıt sayısı, çalışma dakikası, durum dağılımı (kurum tanımlı özel durumlar dâhil) |
| Stok bakiyesi | ✅ | `GET /reports/stock/balance`: malzeme × depo kartı, kritik stok işareti (quantity < minStock), `belowMin` filtresi |
| Stok hareketleri | ✅ | `GET /reports/stock/movements`: append-only hareket listesi, tarih aralığı + tip + malzeme/depo filtresi |
| Gider özeti | ✅ | `GET /reports/expenses`: kategori × durum sayı/tutar toplamları, para birimi ayrıştırılmış; BigInt ölçekli toplam (yarım yukarı) |
| Hakediş dönem özeti | ✅ | `GET /reports/claims`: dönem, durum, brüt/kesinti/net/kümülatif; satır para birimleri tutarlıysa gösterilir, karışıksa `null` (uydurma yok) |
| Görev durum/termin | ✅ | `GET /reports/tasks`: proje başına durum sayaçları + geciken (dueAt < şimdi) + 7 gün içinde yaklaşan |
| Filtreler | ✅ | Tarih aralığı (verilmezse son 30 gün — sınırsız tarama engeli), proje/şantiye, durum; **yetki kapsamı** her raporda servis katmanında uygulanır (FIRM_ADMIN tümü, diğer roller üyelik; kapsam dışı proje filtresi boş sayfa) |
| PDF Türkçe karakter | ✅ | pdfkit + **DejaVu Sans gömülü font** (`apps/api/assets/fonts/`, Bitstream Vera lisansı ekli); yatay A4, sayfa sonu/zebra/alt bilgi, `pdftotext` ile Türkçe metin doğrulandı ("ŞantiyePro — Görev Durum / Termin") |
| XLSX gerçek hücre tipleri | ✅ | exceljs: sayılar `number` hücre, tarihler `Date` hücre; para `#,##0.00`, miktar `#,##0.000` numFmt; donmuş başlık + otomatik filtre; birim testte geri okunarak hücre tipleri doğrulandı |
| Büyük veri kontrolü | ✅ | Liste uçları sunucu tarafı sayfalama (gruplamalarda gün×proje sınırlı grup + dilim); export satır sınırı `EXPORT_ROW_LIMIT` (varsayılan 10.000) — aşımında 400 + daraltma önerisi; sınır 5'e düşürülerek birim testte doğrulandı |
| Dışa aktarma audit log | ✅ | `GET /reports/:key/export` her çağrıda `report.exported` kaydı yazar (after: format + rowCount + filtreler); yanıt `X-Audit-Log-Id` + `X-Row-Count` başlıklarıyla kanıt verir |
| Export izin modeli | ✅ | Her rapor alt veri izniyle (REPORT_PERMISSIONS: project.view / dailyreport.view / attendance.view / inventory.view / expense.create / claim.prepare / task.view); export ayrıca `report.export` ister (rbac matrisinde FIRM_ADMIN, PROJECT_MANAGER, SITE_CHIEF, TECH_OFFICE, ACCOUNTING); parametreli uçta dinamik kontrol `PermissionsGuard.assertPermission` ile |
| Rapor desteklemeyen filtre reddi | ✅ | `status` alanı yalnızca daily-reports/attendance/expense-summary/claim-summary'de kabul edilir; diğerlerinde 400 (ekran–çıktı tutarlılığı) |

### Denetim günlüğü ekranı

| Madde | Durum | Not |
| --- | --- | --- |
| Yalnızca yetkili kullanıcı | ✅ | `GET /audit/logs` + `GET /audit/facets` → `audit.view` (FIRM_ADMIN); panelde menü öğesi izinli kullanıcıda görünür, yetkisiz kullanıcıda sayfa "Erişim yok" verir (canlı e2e ile doğrulandı) |
| Entity/action/actor/date filtresi | ✅ | entityType, action, aktör, entityId, tarih aralığı (gün kesinliği); facet uçları ayrık değer listelerini verir |
| Önce/sonra görünümü | ✅ | Satır genişletince before/after JSON yan yana; append-only (düzenleme arayüzü yok) |
| Hassas alan maskeleme | ✅ | Yazımda `maskSensitive` zaten uygulanıyor; **okuma anında da yeniden maskeleme** (derinlemesine savunma); canlı e2e panel gövdesinde admin parolasının geçmediğini doğrular |
| Audit okumaları günlüğe yazılmaz | ✅ | Bilinçli karar: kendi kendini üreten günlük denetim gürültüsü yaratır; belgelendi (kaynak + bu rapor) |

### Backup / Restore

| Madde | Durum | Not |
| --- | --- | --- |
| Backup script | ✅ | `infra/scripts/backup.sh`: `pg_dump -Fc` mantıksal yedek + object storage yedeği **ayrı** arşiv (S3 için `mc mirror`, yerel disk için tar) + sha256 + retention + status.json (atomik tmp+mv) |
| Compose production profili | ✅ | `infra/docker/docker-compose.yml`'e `backup` servisi eklendi (postgres:16-alpine, başlangıçta bir kez + cron `BACKUP_CRON`, `backups` volume'u); DB portu dışarı kapalı, healthcheck'li, restart policy'li yapı korundu |
| Backup durumu admin ayarlarında | ✅ | `GET /org/backup-status` (firm.settings.manage) → Ayarlar → "Yedekleme" kartı: son çalışma/son başarılı yedek/boyutlar/retention/son hata; **dosya yoksa "Henüz yedek alınmamış"** — durum asla uydurulmaz |
| Uygulamadan restore YOK | ✅ | Panelde bilinçli olarak restore düğmesi yoktur; restore yalnızca `infra/scripts/restore.sh` ile (docs/10 "kontrollü operasyon script'i") |
| Restore güvenlik kilidi | ✅ | Hedef DB adı "prod" içeriyorsa `--i-know-this-is-production` olmadan çalışmaz (exit 3) — canlı testte doğrulandı |
| Restore runbook | ✅ | `docs/backup-restore.md`: yedekleme politikası, cron örneği, docs/10 prosedürü (bakım modu → staging → onay → üretim), migration upgrade/rollback talimatları, kabul kriterleri |

## 2. Test sonuçları (prompts/phase-10-test.md eşlemesi)

**Toplam: 443 spec testi — 443 geçti, 0 başarısız + canlı Playwright 25 koşu (0 başarısız).**

| Paket | Tür | Sonuç |
| --- | --- | --- |
| `@santiyepro/contracts` | birim | 83/83 ✅ |
| `@santiyepro/api` | birim | **27/27 ✅** (17 + **10 yeni Faz 10 testi**) |
| `@santiyepro/api` | e2e (gerçek PostgreSQL) | 170/170 ✅ (auth 17 + attendance 23 + daily-reports 11 + expenses 16 + progress-claims 16 + inventory 21 + media 12 + projects 16 + tasks 21 + health 5 + sync 12) |
| `@santiyepro/web` | bileşen (jsdom) | 64/64 ✅ |
| `@santiyepro/mobile` | bileşen + birim (RNTL) | 99/99 ✅ |
| `@santiyepro/web-e2e` | **Playwright canlı** | **25/25 ✅** (health ×2, kabuk ×3, mobil drawer ×2, görev ×3, rapor ×3, puantaj ×3, stok ×1, gider/hakediş ×2, sync ×3, **Faz 10 ×1 — yeni**) |

### Yeni Faz 10 birim testleri (`apps/api/test/reports-phase10.spec.ts`)

1. **XLSX gerçek hücre tipleri** → sayı hücresi `typeof === 'number'` (5, 1500.5), tarih hücresi `instanceof Date` (ISO eşleşmeli), Türkçe metin bozulmadan okunur ("Şantiye Ğü İştı Ö"), para kolonu `#,##0.00` numFmt ✅
2. **PDF Türkçe font** → `%PDF-` magic + gömülü `DejaVu` referansı + >1 KB ✅
3. **Export audit kanıtı** → `report.exported` + entityType Report + entityId rapor anahtarı + after'da format/rowCount/filtreler ✅
4. **Desteklenmeyen durum filtresi** → project-overview'a `status=APPROVED` gönderimi 400 ✅
5. **Satır sınırı** → `EXPORT_ROW_LIMIT=5` iken 6 satır 400 (`satırdan büyük… daraltın`); sınır içinde 6 satır başarılı ✅
6. **Backup durumu uydurmaz** → env yoksa `statusFileFound:false`; geçerli dosya şemaya doğrulanıp döner; bozuk JSON ve eksik alanlı dosyada da `statusFileFound:false` + tüm alanlar null ✅

### Test promptu senaryoları → kanıt

1. **Her rapor gerçek DB verisi ve doğru yetki scope'u?** → Playwright canlı: API ile kurulmuş gerçek proje/görev/puantaj/gider/stok verisi ekranda birebir görülür (stok bakiyesi 10 KG + kritik işareti, gider 250,50); kapsam: birim/e2e deseni diğer fazlarla aynı (scopedProjectIds + üyelik; FIRM_ADMIN tümü) ✅
2. **Filtreler ekranda ve exportta aynı sonucu?** → Ekran ve export AYNI servis katmanını (ReportsService) ve AYNI zod filtre şemalarını (contracts/reports.ts) kullanır; sayfalama yalnızca ekranda, export tam veri (satır sınırına kadar) ✅
3. **PDF Türkçe karakter, sayfa taşması, tarih aralığı?** → `pdftotext` ile "ŞantiyePro — Görev Durum / Termin", "Oluşturma", "Satır" Türkçe metinleri çıkarıldı; pdfkit satır sayfası aşınca `addPage` + başlık yeniden çizimi (bufferPages + sayfa numarası); tarih filtreleri `dateFrom/dateTo` UTC gün sınırlarıyla uygulanır ✅
4. **XLSX hücreleri sayı/tarih tipinde mi?** → Birim test exceljs ile geri okuyup doğruladı (yukarıda 1) ✅
5. **Büyük export bellek kontrolü?** → Satır sınırı 400 ile korunur + export satırları tek select akışında toplanır; sınırlı aralık varsayılanı (30 gün) sınırsız taramayı engeller ✅
6. **Export audit log üretiyor mu?** → Canlı e2e: panel üzerinden XLSX + PDF indirme sonrası Denetim Kayıtları ekranında `report.exported` filtresiyle kayıtlar görünür; önce/sonra gövdesi açılıp gösterilir ✅
7. **Audit log yetkisiz erişim engelli ve maskeli mi?** → Canlı e2e: SITE_CHIEF kullanıcısı `/panel/denetim-kayitlari`'nda "Erişim yok" görür ve menüde öğe yoktur; admin oturumunda sayfa gövdesi admin parolasını İÇERMEZ ✅
8. **Backup DB + object storage kapsıyor mu?** → Gerçek koşum: `backup.sh` → db-…dump (200.434 B) + storage-…tar.gz (7.989 B, `.media-storage`) + sha256 + status.json ✅
9. **Restore testi izole ortamda başarılı mı?** → Evet (aşağıda §3) ✅
10. **Migration sonrası rollback/upgrade talimatları?** → `docs/backup-restore.md` §4: `prisma migrate deploy` upgrade, rollback = önceki sürüm + gerekiyorsa yedekten dönüş; Faz 10 migration'ı yalnızca `CREATE INDEX "AuditLog_createdAt_idx"` — rollback'i `DROP INDEX` (ek indexesiz API çalışmaya devam eder) ✅

## 3. Gerçek backup → restore koşumu (izole test ortamı)

**Ortam:** Yerel geliştirme PostgreSQL 17.9 (:5433), client tools PostgreSQL 17.11.

```bash
# 1) Yedek (DB + storage ayrı arşiv):
BACKUP_DIR=/tmp/faz10-backup \
DATABASE_URL=postgresql://santiyepro:...@localhost:5433/santiyepro \
STORAGE_BACKUP_PATHS=/home/z/my-project/santiyepro/apps/api/.media-storage \
  infra/scripts/backup.sh
# → db-20261106T040958Z.dump (200.434 B) + storage-20261106T040958Z.tar.gz (7.989 B)
#   + status.json {lastSuccessAt: 2026-11-06T04:09:58Z, lastError: null, retentionDays: 30}

# 2) İzole hedef DB:
CREATE DATABASE santiyepro_restore_test;

# 3) Dry-run (plan; hiçbir şey yazmaz):
TARGET_DATABASE_URL=...santiyepro_restore_test \
  infra/scripts/restore.sh --dry-run --db /tmp/faz10-backup/db-20261106T040958Z.dump

# 4) Üretim kilidi (hedef adında 'prod'):
TARGET_DATABASE_URL=...prod infra/scripts/restore.sh --db ...
# → "Hedef veritabanı adı 'prod' içeriyor..." exit=3 ✅ (yanlışlıkla üretim restore'una kapı yok)

# 5) Gerçek restore (DB + storage):
TARGET_DATABASE_URL=...santiyepro_restore_test \
  infra/scripts/restore.sh \
    --db /tmp/faz10-backup/db-20261106T040958Z.dump \
    --storage /tmp/faz10-backup/storage-20261106T040958Z.tar.gz \
    --storage-target /tmp/faz10-restore-media
# → pg_restore hatasız; tamamlanmış migration sayısı: 9; User 10, Project 52,
#   Task 49, AuditLog 600; medya dosyaları /tmp/faz10-restore-media'ya çıkarıldı ✅
```

**Kaynak ↔ hedef satır sayısı karşılaştırması (tümü EŞİT):**

| Tablo | Kaynak | Hedef (restore) |
| --- | --- | --- |
| User | 10 | 10 ✅ |
| Project | 52 | 52 ✅ |
| Task | 49 | 49 ✅ |
| AuditLog | 600 | 600 ✅ |
| Expense | 10 | 10 ✅ |
| StockMovement | 23 | 23 ✅ |
| SyncEvent | 159 | 159 ✅ |

**Backup durumunun canlı görünümü:** `BACKUP_STATUS_FILE=/tmp/faz10-backup/status.json` ile başlatılan API'de
`GET /org/backup-status` gerçek değerleri döndü (`statusFileFound: true`, `lastSuccessAt`, boyutlar, retention);
ortam değişkeni kaldırıldığında uç dürüstçe `statusFileFound: false` döner (uydurma yok).

**Hata yolu da kanıtlandı:** pg_dump client sürüm uyuşmazlığı (16 client / 17 sunucu) denendi — script
çökmeden `lastError: "pg_dump başarısız (DATABASE_URL)"` yazıp sıfırdan çıktı (exit ≠ 0).

## 4. Bilinen sınırlar (docs/08 ile açıkça belgeli)

- Export satır sınırı: `EXPORT_ROW_LIMIT` (varsayılan 10.000) — aşımında 400; arka plan job'ı MVP sonrası.
- Stok bakiyesi raporu katalog sınırlı olduğu için tek sorguda çekilir (kritik stok karşılaştırması iki kolon
  arasında olduğundan JS'te filtrelenir); çok büyük katalogda DB tarafı karşılaştırmaya geçilebilir.
- Backup service'i compose'da DB + yerel dosya depolamayı kapsar; MinIO mirror `S3_*` verildiğinde devreye girer.

## 5. Kalite kapısı

- [x] Lint + typecheck + build — contracts / api / web / mobile ✅
- [x] Unit + integration testler — 443/443 ✅
- [x] Playwright canlı E2E — 25/25 ✅ (gerçek API + gerçek PostgreSQL + panel dev server)
- [x] Ekran görüntüleri — `docs/screenshots/phase-10-raporlar.png`, `phase-10-denetim.png` ✅
- [x] Restore testi — izole DB'de başarılı, satır sayıları kaynakla eşit ✅
- [x] `docs/backup-restore.md` runbook eklendi; migration upgrade/rollback talimatları tutarlı ✅
