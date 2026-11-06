import { defineConfig } from 'vitest/config';

/**
 * E2E testleri — test/ altındaki *.e2e-spec.ts
 *
 * Faz 11 sertleştirmesi: e2e süiti transactional verileri TEMİZLER. Geliştirme
 * veya canlı önizleme veritabanına (santiyepro) yanlışlıkla bağlanmak veri
 * kaybına yol açar → koşum öncesi DB adı koruması uygulanır. Yalnızca adında
 * "test" veya "e2e" geçen veritabanları kabul edilir (CI: santiyepro_test).
 */
const databaseUrl = process.env.DATABASE_URL ?? '';
const dbName = (() => {
  try {
    const withoutQuery = databaseUrl.split('?')[0] ?? '';
    return withoutQuery.split('/').pop() ?? '';
  } catch {
    return '';
  }
})();

if (!databaseUrl) {
  throw new Error(
    'e2e koşumu için DATABASE_URL zorunludur. Örnek:\n' +
      '  DATABASE_URL=postgresql://santiyepro:santiyepro@127.0.0.1:5433/santiyepro_test pnpm --filter @santiyepro/api test:e2e',
  );
}
if (!/(test|e2e)/i.test(dbName)) {
  throw new Error(
    `e2e süiti yalnızca test veritabanında koşabilir; "DATABASE_URL" bir test/e2e DB'sini işaret etmeli. ` +
      `Alınan DB adı: "${dbName}" — geliştirme/canlı veritabanı korundu (Faz 11 güvenlik kapısı).`,
  );
}

export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    // Tüm e2e dosyaları aynı test veritabanını kullanır → sıralı koşmalı (Faz 03).
    fileParallelism: false,
  },
});
