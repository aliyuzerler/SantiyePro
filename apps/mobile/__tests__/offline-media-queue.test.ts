/**
 * Faz 05 mobil testleri — çevrimdışı medya kuyruğu veri yapısı (docs/09):
 * enqueue → uploading → done/failed akışı, deneme sayacı, retryable, hydrate.
 */
import { describe, expect, it } from '@jest/globals';
import {
  InMemoryMediaQueueAdapter,
  MAX_UPLOAD_ATTEMPTS,
  OfflineMediaQueue,
  generateClientMutationId,
} from '../src/lib/offline-media-queue';

function newQueue(): OfflineMediaQueue {
  return new OfflineMediaQueue(new InMemoryMediaQueueAdapter());
}

describe('OfflineMediaQueue (Faz 05)', () => {
  it('enqueue: bekleyen kayıt ekler; alanlar docs/09 media_queue tanımına uyar', async () => {
    const queue = newQueue();
    const item = await queue.enqueue({
      clientMutationId: 'cm-1',
      localUri: 'file:///tmp/saha-1.jpg',
      targetReportId: 'rep-1',
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
    });

    expect(item.status).toBe('pending');
    expect(item.attemptCount).toBe(0);
    expect(item.lastError).toBeNull();
    expect(item.createdAt).toBeTruthy();
    expect(queue.list('pending')).toHaveLength(1);
    expect(queue.pendingCount()).toBe(1);
  });

  it('markDone: yükleme tamamlanan kayıt kapanır; pendingCount düşer', async () => {
    const queue = newQueue();
    await queue.enqueue({ clientMutationId: 'cm-2', localUri: 'file:///tmp/a.jpg', targetReportId: null, mimeType: 'image/jpeg', sizeBytes: 1 });
    await queue.markUploading('cm-2');
    expect(queue.list('uploading')).toHaveLength(1);
    await queue.markDone('cm-2');
    expect(queue.list('done')).toHaveLength(1);
    expect(queue.pendingCount()).toBe(0);
  });

  it('markFailed: deneme sayacı artar; hak bitince failed kalır; retryable yalnız pending döner', async () => {
    const queue = newQueue();
    await queue.enqueue({ clientMutationId: 'cm-3', localUri: 'file:///tmp/b.jpg', targetReportId: 'rep-2', mimeType: 'image/jpeg', sizeBytes: 5 });

    for (let i = 1; i <= MAX_UPLOAD_ATTEMPTS; i += 1) {
      await queue.markFailed('cm-3', `hata ${i}`);
    }
    const failed = queue.list('failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.attemptCount).toBe(MAX_UPLOAD_ATTEMPTS);
    expect(failed[0]!.lastError).toBe(`hata ${MAX_UPLOAD_ATTEMPTS}`);
    expect(queue.retryable()).toHaveLength(0); // failed yeniden deneme listesinde değildir (Faz 09 kararı)

    await queue.enqueue({ clientMutationId: 'cm-4', localUri: 'file:///tmp/c.jpg', targetReportId: 'rep-2', mimeType: 'image/jpeg', sizeBytes: 6 });
    await queue.markFailed('cm-4', 'ağ yok');
    expect(queue.retryable()).toHaveLength(1); // hak bitmediyse yeniden denenebilir
  });

  it('clearDone: tamamlananlar temizlenir; hydrate adaptörden geri yükler', async () => {
    const adapter = new InMemoryMediaQueueAdapter();
    const queue = new OfflineMediaQueue(adapter);
    await queue.enqueue({ clientMutationId: 'cm-5', localUri: 'file:///tmp/d.jpg', targetReportId: null, mimeType: 'image/png', sizeBytes: 9 });
    await queue.markDone('cm-5');
    await queue.enqueue({ clientMutationId: 'cm-6', localUri: 'file:///tmp/e.jpg', targetReportId: null, mimeType: 'image/png', sizeBytes: 10 });
    await queue.clearDone();
    expect(queue.list()).toHaveLength(1);

    // Kalıcılık: aynı adaptörle yeni kuyruk kuyruğu geri yükler
    const restored = new OfflineMediaQueue(adapter);
    await restored.hydrate();
    expect(restored.list('pending')).toHaveLength(1);
    expect(restored.list()[0]!.clientMutationId).toBe('cm-6');
  });

  it('generateClientMutationId: benzersiz 32 hex üretir (idempotency anahtarı)', () => {
    const a = generateClientMutationId();
    const b = generateClientMutationId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
