#!/usr/bin/env node
/**
 * Yerel PostgreSQL çalıştırıcı (geliştirme/sandbox).
 *
 * Docker bulunmayan ortamlarda gerçek PostgreSQL 17 binary'lerini
 * (embedded-postgres paketinden) kullanıcı yetkileriyle daemon olarak
 * çalıştırır: initdb + pg_ctl start/stop. Veri dizini .localpg/ altındadır
 * ve .gitignore ile hariç tutulmuştur.
 *
 * Müşteri/kurulum ortamında DB, infra/docker/compose.dev.yml üzerinden
 * Docker ile çalıştırılır; bu script yalnızca yerel geliştirmedir.
 *
 * Kullanım:
 *   pnpm local:pg        # başlat (gerekirse initdb + db oluştur)
 *   pnpm local:pg:stop   # durdur
 *   pnpm local:pg:reset  # durdur + veri dizinini sil
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pgDir = join(repoRoot, '.localpg');
const dataDir = join(pgDir, 'data');
const logFile = join(pgDir, 'postgres.log');

const PORT = Number(process.env.LOCAL_PG_PORT ?? 5433);
const USER = process.env.LOCAL_PG_USER ?? 'santiyepro';
const PASSWORD = process.env.LOCAL_PG_PASSWORD ?? 'santiyepro';
const DB_NAME = process.env.LOCAL_PG_DB ?? 'santiyepro';

/** embedded-postgres binary dizinini bul (linux-x64 / linux-arm64). */
function findNativeBin() {
  const base = join(repoRoot, 'node_modules', '.pnpm');
  if (!existsSync(base)) throw new Error('node_modules/.pnpm bulunamadı; önce pnpm install çalıştırın.');
  const entries = readdirSync(base).filter((e) => e.startsWith('@embedded-postgres+linux-'));
  for (const entry of entries) {
    const arch = (entry.split('+')[1] ?? '').split('@')[0];
    const cand = join(base, entry, 'node_modules', '@embedded-postgres', arch, 'native');
    if (existsSync(join(cand, 'bin', 'pg_ctl'))) return join(cand, 'bin');
  }
  throw new Error('PostgreSQL binary dizini bulunamadı (@embedded-postgres/linux-*).');
}

function bin(name) {
  return join(findNativeBin(), name);
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

/**
 * pg_ctl status ile kontrol edilir — embedded-postgres paketi yalnızca
 * postgres/initdb/pg_ctl binary'lerini içerir; pg_isready/psql yoktur.
 */
function isUp() {
  if (!existsSync(join(dataDir, 'PG_VERSION'))) return false;
  const result = spawnSync(bin('pg_ctl'), ['-D', dataDir, 'status'], { encoding: 'utf8' });
  return result.status === 0;
}

async function up() {
  mkdirSync(pgDir, { recursive: true });

  if (isUp()) {
    console.log(`PostgreSQL zaten çalışıyor (port ${PORT}).`);
    printConnString();
    return;
  }

  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    console.log('initdb çalıştırılıyor...');
    const pwFile = join(pgDir, 'pwfile.tmp');
    writeFileSync(pwFile, PASSWORD);
    try {
      execFileSync(
        bin('initdb'),
        [
          '-D', dataDir,
          '-U', USER,
          '--pwfile', pwFile,
          '--auth-host=scram-sha-256',
          '--auth-local=trust',
          '--encoding=UTF8',
          '--locale=C',
        ],
        { stdio: 'pipe' },
      );
    } finally {
      if (existsSync(pwFile)) unlinkSync(pwFile);
    }
    console.log('initdb tamamlandı.');
  }

  console.log(`PostgreSQL başlatılıyor (port ${PORT})...`);
  run(bin('pg_ctl'), [
    '-D', dataDir,
    '-l', logFile,
    '-o', `-p ${PORT} -c listen_addresses='127.0.0.1'`,
    'start',
  ]);

  // Veritabanını oluştur (zaten varsa atla) — SQL için apps/api'nin Prisma istemcisi kullanılır
  await ensureDatabase();

  printConnString();
  console.log(`Log dosyası: ${logFile}`);
}

/** pg_database denetimi + CREATE DATABASE (psql olmadan). */
async function ensureDatabase() {
  const { createRequire } = await import('node:module');
  const requireFromApi = createRequire(join(repoRoot, 'apps', 'api', 'package.json'));
  const { PrismaClient } = requireFromApi('@prisma/client');
  const adminUrl = `postgresql://${encodeURIComponent(USER)}:${encodeURIComponent(PASSWORD)}@127.0.0.1:${PORT}/postgres`;
  const prisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`,
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${DB_NAME}"`);
      console.log(`Veritabanı oluşturuldu: ${DB_NAME}`);
    } else {
      console.log(`Veritabanı mevcut: ${DB_NAME}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function printConnString() {
  console.log('');
  console.log('Bağlantı dizesi (apps/api/.env):');
  console.log(`DATABASE_URL=postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB_NAME}?schema=public`);
}

function stop() {
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    console.log('Veri dizini yok; durdurulacak süreç yok.');
    return;
  }
  if (!isUp()) {
    console.log('Çalışan PostgreSQL yok.');
    return;
  }
  run(bin('pg_ctl'), ['-D', dataDir, 'stop', '-m', 'fast']);
  console.log('PostgreSQL durduruldu.');
}

function reset() {
  stop();
  if (existsSync(pgDir)) {
    rmSync(pgDir, { recursive: true, force: true });
    console.log('.localpg veri dizini silindi.');
  }
}

const command = process.argv[2] ?? 'up';
if (command === 'up') await up();
else if (command === 'stop') stop();
else if (command === 'reset') reset();
else {
  console.error('Bilinmeyen komut. Kullanım: local-postgres.mjs [up|stop|reset]');
  process.exit(1);
}
