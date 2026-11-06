#!/usr/bin/env bash
# ============================================================
# ŞantiyePro — Geri yükleme script'i (Faz 10, docs/10-deployment-backup.md)
#
# KONTROLLÜ OPERASYON: Uygulama içinden restore BAŞLATILMAZ. Bu script yalnızca
# operatör tarafından, docs/10 prosedürüyle (bakım modu → staging → üretim) kullanılır.
#
# Kullanım:
#   TARGET_DATABASE_URL="postgresql://.../santiyepro_restore_test" \
#     ./restore.sh --db /backups/db-XXXX.dump [--storage /backups/storage-XXXX.tar.gz --storage-target /data]
#
# Güvenlik kilidi:
#   - Hedef DB adında "prod" geçiyorsa script --i-know-this-is-production bayrağı
#     olmadan ÇALIŞMAZ (yanlışlıkla üretim üstüne yazmayı engeller).
#   - --dry-run yalnızca planı yazdırır, hiçbir şey yazmaz.
# ============================================================
set -euo pipefail

DB_DUMP=""
STORAGE_TAR=""
STORAGE_TARGET=""
DRY_RUN=0
FORCE_PROD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB_DUMP="$2"; shift 2 ;;
    --storage) STORAGE_TAR="$2"; shift 2 ;;
    --storage-target) STORAGE_TARGET="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --i-know-this-is-production) FORCE_PROD=1; shift ;;
    *) echo "Bilinmeyen argüman: $1" >&2; exit 2 ;;
  esac
done

[ -n "$DB_DUMP" ] || { echo "--db zorunludur"; exit 2; }
[ -f "$DB_DUMP" ] || { echo "DB yedeği bulunamadı: $DB_DUMP"; exit 2; }
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL tanımlı olmalı}"

command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore bulunamadı (postgresql-client kurun)"; exit 2; }

# Hedef adı güvenlik kilidi
TARGET_NAME=$(printf '%s' "$TARGET_DATABASE_URL" | sed -E 's|.*/([^/?]+)(\?.*)?$|\1|')
case "$TARGET_NAME" in
  *prod*)
    [ "$FORCE_PROD" -eq 1 ] || {
      echo "Hedef veritabanı adı 'prod' içeriyor. Üretim restore'ı için --i-know-this-is-production bayrağını ekleyin"
      echo "ve docs/10 prosedürünü izleyin: bakım modu → staging restore → müşteri onayı → üretim."
      exit 3
    }
    ;;
esac

echo "=== ŞantiyePro Restore Planı ==="
echo "DB yedeği     : $DB_DUMP ($(stat -c %s "$DB_DUMP" 2>/dev/null || stat -f %z "$DB_DUMP") bayt)"
echo "Hedef DB      : $TARGET_NAME"
[ -n "$STORAGE_TAR" ] && echo "Storage yedeği: $STORAGE_TAR → $STORAGE_TARGET"
[ "$DRY_RUN" -eq 1 ] && { echo "(dry-run — hiçbir şey yazılmayacak)"; exit 0; }

echo "=== 1) DB restore (pg_restore --clean --if-exists) ==="
pg_restore --clean --if-exists --no-owner --no-privileges -d "$TARGET_DATABASE_URL" "$DB_DUMP"

echo "=== 2) Migration uyumu doğrulaması ==="
psql "$TARGET_DATABASE_URL" -tAc "SELECT COUNT(*) FROM _prisma_migrations;" >/dev/null \
  || { echo "UYARI: _prisma_migrations okunamadı — hedef şema migration uyumlu olmayabilir"; exit 4; }
MIG_COUNT=$(psql "$TARGET_DATABASE_URL" -tAc "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")
echo "Tamamlanmış migration sayısı: $MIG_COUNT"

echo "=== 3) Kritik tablo satır sayıları (örnek doğrulama) ==="
for TABLE in User Project Task AuditLog; do
  COUNT=$(psql "$TARGET_DATABASE_URL" -tAc "SELECT COUNT(*) FROM \"$TABLE\";" 2>/dev/null || echo 'N/A')
  echo "  $TABLE: $COUNT"
done

if [ -n "$STORAGE_TAR" ]; then
  [ -f "$STORAGE_TAR" ] || { echo "Storage yedeği bulunamadı: $STORAGE_TAR"; exit 2; }
  [ -n "$STORAGE_TARGET" ] || { echo "--storage verildi ama --storage-target eksik"; exit 2; }
  echo "=== 4) Storage restore → $STORAGE_TARGET ==="
  mkdir -p "$STORAGE_TARGET"
  tar xzf "$STORAGE_TAR" -C "$STORAGE_TARGET"
  echo "Dosyalar çıkarıldı. Medya referanslarının (localRef/mediaId) DB ile eşleştiğini doğrulayın."
fi

echo "=== Restore tamam ==="
echo "Sonraki adımlar (docs/10): kritik iş akışlarını doğrula → müşteri onayı → üretim restore'unda aynı prosedür."
