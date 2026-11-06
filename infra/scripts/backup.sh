#!/usr/bin/env bash
# ============================================================
# ŞantiyePro — Yedekleme script'i (Faz 10, docs/10-deployment-backup.md)
#
# Ne yapar:
#   1. PostgreSQL mantıksal yedeği (pg_dump, custom format -Fc)
#   2. Object storage / dosya depolama yedeği (ayrı arşiv; DB yedeğiyle
#      AYNI zaman penceresinde) — S3 uyumlu depo için `mc mirror`,
#      yerel disk için tar arşivi
#   3. status.json yazar (API /org/backup-status bunu okur — salt okunur)
#   4. Retention: BACKUP_RETENTION_DAYS'ten eski yedekleri siler
#
# Kullanım (cron örneği: her gece 02:00):
#   0 2 * * * BACKUP_DIR=/backups PGPASSWORD=... /opt/santiyepro/infra/scripts/backup.sh >> /backups/backup.log 2>&1
#
# Gerekli ortam değişkenleri:
#   BACKUP_DIR            Yedeklerin yazılacağı dizin
#   PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE  veya DATABASE_URL
# Opsiyonel:
#   BACKUP_RETENTION_DAYS (varsayılan 30)
#   BACKUP_STATUS_FILE    (varsayılan $BACKUP_DIR/status.json)
#   STORAGE_BACKUP_PATHS  İki noktala ayrılmış yerel dizin listesi (ör. /data/media:/data/uploads)
#   S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY/S3_BUCKET  MinIO/S3 mirror (mc)
# ============================================================
set -euo pipefail

: "${BACKUP_DIR:?BACKUP_DIR tanımlı olmalı}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STATUS_FILE="${BACKUP_STATUS_FILE:-$BACKUP_DIR/status.json}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
START_TS="$(date -u +%s)"

mkdir -p "$BACKUP_DIR"

DB_FILE="$BACKUP_DIR/db-$STAMP.dump"
STORAGE_FILE="$BACKUP_DIR/storage-$STAMP.tar.gz"
LOG_FILE="$BACKUP_DIR/backup.log"

write_status() {
  # Atomik yazım (tmp + mv) — API okuması yarım dosya görmez.
  local last_error="$1" db_file="$2" db_size="$3" storage_file="$4" storage_size="$5" success_at="$6"
  local tmp="$STATUS_FILE.tmp.$$"
  cat > "$tmp" <<JSON
{
  "lastRunAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "lastSuccessAt": $success_at,
  "lastError": $last_error,
  "lastDbBackupFile": $db_file,
  "lastDbBackupSizeBytes": $db_size,
  "lastStorageBackupFile": $storage_file,
  "lastStorageBackupSizeBytes": $storage_size,
  "retentionDays": $RETENTION_DAYS
}
JSON
  mv "$tmp" "$STATUS_FILE"
}

json_escape() {
  # Basit JSON string kaçışı (çift tırnak + ters bölü)
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

null_or_string() {
  # Boş değeri JSON null olarak yazar; doluyu "..." string'e çevirir.
  if [ -z "$1" ]; then printf 'null'; else printf '"%s"' "$(json_escape "$1")"; fi
}

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }

fail() {
  log "HATA: $1"
  write_status "\"$(json_escape "$1")\"" null null null null null
  exit 1
}

# ---------- 1) DB yedeği ----------
DB_ERR=""
if command -v pg_dump >/dev/null 2>&1; then
  log "DB yedeği başlıyor: $DB_FILE"
  if [ -n "${DATABASE_URL:-}" ]; then
    pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges -f "$DB_FILE" 2>>"$LOG_FILE" || DB_ERR="pg_dump başarısız (DATABASE_URL)"
  else
    pg_dump -h "${PGHOST:-db}" -p "${PGPORT:-5432}" -U "${PGUSER:-santiyepro}" -d "${PGDATABASE:-santiyepro}" \
      -Fc --no-owner --no-privileges -f "$DB_FILE" 2>>"$LOG_FILE" || DB_ERR="pg_dump başarısız (PG* değişkenleri)"
  fi
else
  DB_ERR="pg_dump bulunamadı"
fi
[ -n "$DB_ERR" ] && fail "$DB_ERR"
DB_SIZE=$(stat -c %s "$DB_FILE" 2>/dev/null || stat -f %z "$DB_FILE")
[ "$DB_SIZE" -gt 0 ] || fail "DB yedeği boş (0 bayt)"
log "DB yedeği tamam: $DB_SIZE bayt"

# ---------- 2) Object storage yedeği (DB'den AYRI ama aynı pencerede) ----------
STORAGE_ERR=""
STORAGE_FILE_OUT=""
STORAGE_SIZE_OUT=0
if [ -n "${S3_ENDPOINT:-}" ] && command -v mc >/dev/null 2>&1; then
  log "S3 mirror başlıyor: $S3_ENDPOINT/$S3_BUCKET → $BACKUP_DIR/s3-$STAMP/"
  mc alias set santiyepro-src "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >>"$LOG_FILE" 2>&1 || STORAGE_ERR="mc alias hatası"
  if [ -z "$STORAGE_ERR" ]; then
    mc mirror --only-missing "santiyepro-src/$S3_BUCKET" "$BACKUP_DIR/s3-$STAMP" >>"$LOG_FILE" 2>&1 || STORAGE_ERR="mc mirror başarısız"
    STORAGE_FILE_OUT="$BACKUP_DIR/s3-$STAMP"
  fi
elif [ -n "${STORAGE_BACKUP_PATHS:-}" ]; then
  log "Dosya depolama yedeği: $STORAGE_BACKUP_PATHS → $STORAGE_FILE"
  IFS=':' read -ra PATHS <<< "$STORAGE_BACKUP_PATHS"
  TAR_ARGS=()
  for p in "${PATHS[@]}"; do
    [ -d "$p" ] && TAR_ARGS+=("$p") || log "UYARI: yedeklenecek dizin yok, atlandı: $p"
  done
  if [ "${#TAR_ARGS[@]}" -eq 0 ]; then
    STORAGE_ERR="STORAGE_BACKUP_PATHS içinde geçerli dizin yok"
  else
    tar czf "$STORAGE_FILE" "${TAR_ARGS[@]}" 2>>"$LOG_FILE" || STORAGE_ERR="tar başarısız"
    STORAGE_FILE_OUT="$STORAGE_FILE"
  fi
else
  log "UYARI: storage yedeği atlandı (S3_* veya STORAGE_BACKUP_PATHS verilmedi) — docs/10 uyarınca object storage yedeği ayrıca zorunludur"
fi
[ -z "$STORAGE_ERR" ] || fail "$STORAGE_ERR"
if [ -n "$STORAGE_FILE_OUT" ] && [ -f "$STORAGE_FILE_OUT" ]; then
  STORAGE_SIZE_OUT=$(stat -c %s "$STORAGE_FILE_OUT" 2>/dev/null || stat -f %z "$STORAGE_FILE_OUT")
fi

# ---------- 3) Bütünlük kanıtı ----------
sha256sum "$DB_FILE" > "$DB_FILE.sha256" || true
[ -f "$STORAGE_FILE" ] && sha256sum "$STORAGE_FILE" > "$STORAGE_FILE.sha256" || true

# ---------- 4) Retention ----------
if [ "$RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
  find "$BACKUP_DIR" -name 'db-*.dump' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
  find "$BACKUP_DIR" -name 'storage-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
  find "$BACKUP_DIR" -name '*.sha256' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
  log "Retention uygulandı: > $RETENTION_DAYS gün"
fi

# ---------- 5) Durum ----------
END_TS="$(date -u +%s)"
log "Yedek tamam ($(("$END_TS" - "$START_TS")) sn): db=$DB_SIZE storage=$STORAGE_SIZE_OUT"
write_status "null" \
  "\"$(json_escape "$DB_FILE")\"" \
  "$DB_SIZE" \
  "$( [ -n "$STORAGE_FILE_OUT" ] && printf '"%s"' "$(json_escape "$STORAGE_FILE_OUT")" || printf 'null' )" \
  "$STORAGE_SIZE_OUT" \
  "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
