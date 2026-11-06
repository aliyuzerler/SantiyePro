# ŞantiyePro — Yedekleme ve Geri Yükleme Runbook'u (Faz 10)

Bu doküman `docs/10-deployment-backup.md` kurallarının operasyonel adımlarıdır.
Script'ler: `infra/scripts/backup.sh` ve `infra/scripts/restore.sh`.

## 1. Yedekleme politikası

| Konu | Değer |
| --- | --- |
| Kapsam | PostgreSQL mantıksal yedeği (`pg_dump -Fc`) **ve** object storage (ayrı arşiv) |
| Sıklık | Günlük (Compose'da varsayılan `BACKUP_CRON=0 2 * * *`); müşteri ihtiyacına göre ayarlanır |
| Retention | `BACKUP_RETENTION_DAYS` (varsayılan 30 gün); günlük/haftalık/aylık kopya politikası müşteriyle kararlaştırılır |
| Hedef | Production sunucusundan AYRI bir dizin/volume (`backups` volume'u; müşteri kurulumunda ayrı disk/uzak hedef) |
| Bütünlük | Her yedek için `.sha256` dosyası üretilir |
| Görünürlük | Son durum API'den `GET /org/backup-status` (yalnızca firma yöneticisi) veya Ayarlar ekranındaki "Yedekleme" kartı |
| Başarı/failure logu | `BACKUP_DIR/backup.log` + `status.json` içindeki `lastError` |

Kural: yedek dosyasının varlığı yeterli değildir; **periyodik restore testi zorunludur** (aşağıda §3).

## 2. Backup script'i

```bash
# Örnek (sunucuda cron):
0 2 * * * BACKUP_DIR=/backups \
  PGHOST=db PGUSER=santiyepro PGPASSWORD=... PGDATABASE=santiyepro \
  STORAGE_BACKUP_PATHS=/data/media \
  /opt/santiyepro/infra/scripts/backup.sh >> /backups/backup.log 2>&1
```

- S3 uyumlu depo kullanılıyorsa `STORAGE_BACKUP_PATHS` yerine `S3_ENDPOINT`,
  `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` verilir; script `mc mirror` ile
  ayrı bir kopya alır.
- Script başarı/başarısızlıkta da `status.json` yazar (atomik `tmp + mv`).
  API bu dosyayı yalnızca **okur**; uygulama içinden restore başlatılmaz.

## 3. Geri yükleme prosedürü (docs/10 adımları)

1. **Bakım modu**: uygulamayı bakım moduna al (kullanıcı akışları durur).
2. **Zaman penceresi doğrulaması**: DB ve storage yedeklerinin aynı pencereye
   ait olduğunu `status.json` / dosya adlarındaki zaman damgasından doğrula.
3. **Önce staging**: yedeği İZOLE bir test veritabanına restore et (aşağıda).
4. **Uyumluluk**: `_prisma_migrations` sayısı ve kritik tablo satır sayılarını
   kontrol et (script otomatik yazdırır).
5. **Müşteri onayı** sonrası üretim restore'ı (script üretim hedefinde
   `--i-know-this-is-production` bayrağı ister — yanlışlıkla üstüne yazmaya karşı kilit).
6. **Açılış**: uygulamayı aç, kritik iş akışlarını doğrula (giriş, günlük rapor,
   stok çıkışı, hakediş görüntüleme).

### 3.1 Restore test komutları

```bash
# 1) İzole test hedefine restore (dry-run ile planı gör):
TARGET_DATABASE_URL="postgresql://.../santiyepro_restore_test" \
  infra/scripts/restore.sh --dry-run --db backups/db-XXXX.dump

# 2) Gerçek restore:
TARGET_DATABASE_URL="postgresql://.../santiyepro_restore_test" \
  infra/scripts/restore.sh \
    --db backups/db-XXXX.dump \
    --storage backups/storage-XXXX.tar.gz --storage-target /tmp/restore-media
```

Script çıktısı şunları raporlar: tamamlanmış migration sayısı, `User`, `Project`,
`Task`, `AuditLog` satır sayıları. Storage restore sonrası medya referansları
(`localRef`/`mediaId`) DB ile eşleşmeli.

### 3.2 Restore testi kabul kriterleri

- `pg_restore` hatasız biter (exit 0).
- `_prisma_migrations` tamam sayısı, yedek alındığındaki migration sayısıyla eşit.
- Kritik tablo satır sayıları kaynağla tutarlı (fark yalnızca yedek sonrası
  üretilen geçici kayıtlardan olabilir).
- API restore edilmiş DB'ye bağlanıp health/ready `ok` döner ve bir iş akışı
  (ör. proje listesi + görev görüntüleme) çalışır.

## 4. Migration upgrade / rollback

- **Upgrade**: deployment öncesi `npx prisma migrate deploy` (yalnızca bekleyen
  migration'ları uygular; adım adım, atomik). Uygulama sürüm notunda hangi
  migration'ların geldiği listelenir.
- **Rollback**: Prisma migration'ları tersine dönüştürmez. Rollback = (1) uygulamanın
  önceki sürümüne dön, (2) gerekiyorsa restore prosedürüyle yedekten dön
  (§3). Bu yüzden her fazın migration'ı geriye uyumlu yazılır (sadece ekleme,
  kırıcı değişiklik ayrı faz + veri taşima script'iyle).
- Faz 10 migration örneği: `20261106033504_phase10_audit_created_at_idx`
  (yalnızca `CREATE INDEX` — rollback'i: `DROP INDEX "AuditLog_createdAt_idx";`;
  ek indexesiz şemada API çalışmaya devam eder, yalnızca tarih taramaları yavaşlar).

## 5. Sorumluluk ayrımı

| İşlem | Nerede |
| --- | --- |
| Yedek alma | `backup.sh` (cron / Compose `backup` servisi) |
| Yedek durumunu GÖRME | Panel → Ayarlar → Yedekleme kartı (firma yöneticisi) |
| Restore BAŞLATMA | Yalnızca operatör, `restore.sh` ile — panelde restore düğmesi YOKTUR (bilinçli karar, docs/10) |
