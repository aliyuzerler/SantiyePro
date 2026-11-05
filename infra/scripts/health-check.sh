#!/usr/bin/env bash
# ============================================================
# ŞantiyePro — yerel tam yığın sağlık kontrolü
# PostgreSQL (embedded) + API'yi başlatır, uçları doğrular,
# sonra her şeyi kapatır. Docker bulunmayan ortamlarda kullanılır.
# Kullanım: bash infra/scripts/health-check.sh
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

API_PID=""
PG_STARTED=0

cleanup() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    echo "[health-check] API durduruldu"
  fi
  if [ "$PG_STARTED" = "1" ]; then
    node infra/scripts/local-postgres.mjs stop >/dev/null 2>&1 || true
    echo "[health-check] PostgreSQL durduruldu"
  fi
}
trap cleanup EXIT

echo "[health-check] 1/4 PostgreSQL başlatılıyor..."
if ! node -e "const n=require('net');const s=n.createConnection({host:'127.0.0.1',port:5433},()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1000)" 2>/dev/null; then
  node infra/scripts/local-postgres.mjs up
  PG_STARTED=1
  sleep 2
else
  echo "[health-check] PostgreSQL zaten çalışıyor"
fi

echo "[health-check] 2/4 API derlenmiş mi kontrol ediliyor..."
if [ ! -f apps/api/dist/main.js ]; then
  echo "[health-check] dist yok; nest build çalıştırılıyor..."
  (cd apps/api && pnpm run build)
fi

echo "[health-check] 3/4 API başlatılıyor..."
(cd apps/api && node dist/main.js) > /tmp/santiyepro-health-api.log 2>&1 &
API_PID=$!

for i in $(seq 1 30); do
  if curl -sf http://localhost:4000/api/v1/health >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "[health-check] 4/4 Uçlar doğrulanıyor..."
FAIL=0

check() {
  local name="$1" url="$2" expect="$3"
  local code
  code=$(curl -s -o /tmp/hc-body -w "%{http_code}" "$url" || echo "000")
  if [ "$code" = "$expect" ]; then
    echo "  PASS  $name -> $code"
  else
    echo "  FAIL  $name -> $code (beklenen $expect)"
    cat /tmp/hc-body || true
    FAIL=1
  fi
}

check "GET /api/v1/health"       "http://localhost:4000/api/v1/health"       "200"
check "GET /api/v1/health/live"  "http://localhost:4000/api/v1/health/live"  "200"
check "GET /api/v1/health/ready" "http://localhost:4000/api/v1/health/ready" "200"
check "GET /api/v1/docs"         "http://localhost:4000/api/v1/docs"         "200"

if [ "$FAIL" = "0" ]; then
  echo "[health-check] SONUÇ: TÜM KONTROLLER GEÇTİ"
else
  echo "[health-check] SONUÇ: BAŞARISIZ KONTROLLER VAR"
  exit 1
fi
