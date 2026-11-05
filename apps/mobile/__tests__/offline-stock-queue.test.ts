/**
 * Faz 07 mobil testleri — çevrimdışı stok kuyruğu (docs/09 yaklaşımı):
 * duplicate/çakışma koruması, idempotent clientMutationId, flush akışı,
 * deneme sayacı, hydrate. Geliştirme promptu: "Offline cihazdaki son bilinen
 * stok uyarı olarak gösterilir; kesin kabul sunucu doğrulamasına bağlıdır".
 */
import { describe, expect, it } from '@jest/globals';
import {
  InMemoryStockQueueAdapter,
  MAX_STOCK_ATTEMPTS,
  OfflineStockQueue,
  stockQueueKey,
} from '../src/lib/offline-stock-queue';

function newQueue(): OfflineStockQueue {
  return new OfflineStockQueue(new InMemoryStockQueueAdapter());
}

const baseInput = {
  clientMutationId: 'stock-cm-1',
  type: 'OUT' as const,
  materialId: 'mat-1',
  materialName: 'Çimento CEM I 42,5',
  warehouseId: 'wh-1',
  warehouseName: 'Merkez Depo',
  targetWarehouseId: null,
  quantity: '5',
  unit: 'TORBA',
  note: null,
};

describe('OfflineStockQueue (Faz 07)', () => {
  it('enqueue: bekleyen hareket ekler; kuyruk anahtarı malzeme/depo/tip bileşimidir', async () => {
    const queue = newQueue();
    const result = await queue.enqueue(baseInput);
    const item = result.item;

    expect(item.status).toBe('pending');
    expect(item.attemptCount).toBe(0);
    expect(item.hadConflict).toBe(false);
    expect(stockQueueKey(item)).toBe('mat-1|wh-1|OUT');
    expect(queue.pendingCount()).toBe(1);
  });

  it('duplicate: aynı malzeme/depo/tip ve miktar kuyrukta bekliyorsa çift kayıt oluşmaz', async () => {
    const queue = newQueue();
    await queue.enqueue(baseInput);
    const result = await queue.enqueue({ ...baseInput, clientMutationId: 'stock-cm-2' });

    expect(result.wasDuplicate).toBe(true);
    expect(result.hadConflict).toBe(false);
    expect(queue.list('pending')).toHaveLength(1);
  });

  it('yerel çakışma: farklı miktar bekleyeni değiştirir, yeni clientMutationId alınır', async () => {
    const queue = newQueue();
    await queue.enqueue(baseInput);
    const result = await queue.enqueue({
      ...baseInput,
      clientMutationId: 'stock-cm-3',
      quantity: '8',
    });

    expect(result.wasDuplicate).toBe(false);
    expect(result.hadConflict).toBe(true);
    expect(result.item.quantity).toBe('8');
    expect(result.item.clientMutationId).toBe('stock-cm-3');
    const pending = queue.list('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.quantity).toBe('8');
  });

  it('aynı tip farklı depo ayrı kayıttır (anahtar deposuz benzersiz değildir)', async () => {
    const queue = newQueue();
    await queue.enqueue(baseInput);
    await queue.enqueue({ ...baseInput, clientMutationId: 'stock-cm-4', warehouseId: 'wh-2', warehouseName: 'Şantiye Deposu' });
    expect(queue.list('pending')).toHaveLength(2);
  });

  it('flush: gönderici başarılıysa kayıt kapanır; false/başarısızlıkta attemptCount artar', async () => {
    const queue = newQueue();
    await queue.enqueue(baseInput);

    const sent = await queue.flush(async () => true);
    expect(sent.sent).toBe(1);
    expect(sent.failed).toBe(0);
    expect(queue.pendingCount()).toBe(0);

    await queue.clearDone();
    expect(queue.list()).toHaveLength(0);

    // Başarısızlık yolu: sender false → markFailed, hak bitmediyse pending kalır
    await queue.enqueue({ ...baseInput, clientMutationId: 'stock-cm-5' });
    const failedResult = await queue.flush(async () => false);
    expect(failedResult.failed).toBe(1);
    expect(queue.list('failed')).toHaveLength(0); // hak bitmedi: hâlâ pending
    const pending = queue.list('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.attemptCount).toBe(1);
    expect(pending[0]!.lastError).toBe('Sunucu kaydı kabul etmedi');
  });

  it('flush: MAX denemeye ulaşan kayıt failed kalır; failed kayıtlar yeniden denenir', async () => {
    const queue = newQueue();
    await queue.enqueue({ ...baseInput, clientMutationId: 'stock-cm-6' });

    for (let i = 0; i < MAX_STOCK_ATTEMPTS; i += 1) {
      await queue.flush(async () => false);
    }
    expect(queue.list('failed')).toHaveLength(1);
    expect(queue.pendingCount()).toBe(1); // failed de bekleyen sayılır

    // failed kayıtlar da flush'ta yeniden denenir (Faz 09 retry):
    const result = await queue.flush(async () => true);
    expect(result.sent).toBe(1);
  });

  it('409 negatif stok reddi done sayılır: tekrar gönderilmez (sunucu kararı kesindir)', async () => {
    const queue = newQueue();
    await queue.enqueue({ ...baseInput, clientMutationId: 'stock-cm-7' });
    await queue.markDone('stock-cm-7');
    expect(queue.list('done')).toHaveLength(1);
    expect(queue.pendingCount()).toBe(0);
  });

  it('hydrate: kalıcı adaptörden kayıtlar geri yüklenir', async () => {
    const adapter = new InMemoryStockQueueAdapter();
    const writer = new OfflineStockQueue(adapter);
    await writer.enqueue(baseInput);

    const reader = new OfflineStockQueue(adapter);
    await reader.hydrate();
    expect(reader.pendingCount()).toBe(1);
    expect(reader.list('pending')[0]!.materialName).toBe('Çimento CEM I 42,5');
  });
});
