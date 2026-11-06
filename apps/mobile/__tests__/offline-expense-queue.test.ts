/**
 * Faz 08 mobil testleri — çevrimdışı gider kuyruğu (docs/09 yaklaşımı).
 * Gider append-only/işlem bazlıdır: bekleyen kayıt sessizce değiştirilmez;
 * aynı clientMutationId duplicate kabul edilir; sunucu reddi 'done'dur.
 */
import { describe, expect, it } from '@jest/globals';
import {
  InMemoryExpenseQueueAdapter,
  MAX_EXPENSE_ATTEMPTS,
  OfflineExpenseQueue,
} from '../src/lib/offline-expense-queue';

function newQueue(): OfflineExpenseQueue {
  return new OfflineExpenseQueue(new InMemoryExpenseQueueAdapter());
}

const baseInput = {
  clientMutationId: 'exp-cm-1',
  projectId: 'prj-1',
  projectName: 'Köprü Bakım',
  categoryId: 'cat-1',
  categoryName: 'Yakıt',
  vendorName: 'Petrol Ofisi',
  description: 'Dizel alımı',
  amount: '1250.50',
  currency: 'TRY',
  taxRate: null,
  expenseDate: '2026-01-15',
};

describe('OfflineExpenseQueue (Faz 08)', () => {
  it('enqueue: bekleyen gider ekler; vergi oranı verilmezse null kalır (uydurma yok)', async () => {
    const queue = newQueue();
    const result = await queue.enqueue(baseInput);

    expect(result.item.status).toBe('pending');
    expect(result.item.attemptCount).toBe(0);
    expect(result.item.taxRate).toBeNull();
    expect(result.wasDuplicate).toBe(false);
    expect(queue.pendingCount()).toBe(1);
  });

  it('duplicate: aynı clientMutationId kuyrukta bekliyorsa çift kayıt oluşmaz', async () => {
    const queue = newQueue();
    await queue.enqueue(baseInput);
    const again = await queue.enqueue({ ...baseInput, amount: '999' });

    expect(again.wasDuplicate).toBe(true);
    expect(again.item.amount).toBe('1250.50'); // ilk kayıt değişmez (append-only)
    expect(queue.pendingCount()).toBe(1);
  });

  it('farklı clientMutationId ile ikinci gider ayrı kayıt olarak bekler', async () => {
    const queue = newQueue();
    await queue.enqueue(baseInput);
    await queue.enqueue({ ...baseInput, clientMutationId: 'exp-cm-2', description: 'İnşaat malzemesi' });

    expect(queue.pendingCount()).toBe(2);
    expect(queue.list('pending').map((i) => i.description).sort()).toEqual(['Dizel alımı', 'İnşaat malzemesi']);
  });

  it('flush: sunucu onayı kaydı kapatır ve clearDone temizler', async () => {
    const queue = newQueue();
    await queue.enqueue(baseInput);
    const sent: string[] = [];
    const result = await queue.flush(async (item) => {
      sent.push(item.clientMutationId);
      return { ok: true };
    });

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(sent).toEqual(['exp-cm-1']);
    await queue.clearDone();
    expect(queue.pendingCount()).toBe(0);
  });

  it('flush: sunucu reddi (permanent 4xx) "done"dur ve hata not edilir — tekrar gönderilmez', async () => {
    const queue = newQueue();
    await queue.enqueue(baseInput);
    let attempts = 0;
    const result = await queue.flush(async () => {
      attempts += 1;
      return { ok: false, permanent: true, error: 'Kategori bulunamadı' };
    });

    expect(attempts).toBe(1);
    expect(result.sent).toBe(1); // kalıcı karar → kapanır
    expect(queue.list('done')[0].lastError).toBe('Kategori bulunamadı');
  });

  it('flush: geçici hata attemptCount artırır; MAX denemede failed kalır', async () => {
    const queue = newQueue();
    await queue.enqueue(baseInput);

    for (let i = 0; i < MAX_EXPENSE_ATTEMPTS; i += 1) {
      await queue.flush(async () => {
        throw new Error('ağ yok');
      });
    }
    const failed = queue.list('failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].attemptCount).toBe(MAX_EXPENSE_ATTEMPTS);
    expect(failed[0].lastError).toBe('ağ yok');
    expect(queue.pendingCount()).toBe(1); // failed hâlâ bekliyor sayılır
  });

  it('hydrate: kalıcı depodan geri yükler', async () => {
    const adapter = new InMemoryExpenseQueueAdapter();
    const writer = new OfflineExpenseQueue(adapter);
    await writer.enqueue(baseInput);

    const reader = new OfflineExpenseQueue(adapter);
    await reader.hydrate();
    expect(reader.pendingCount()).toBe(1);
    expect(reader.list('pending')[0].projectName).toBe('Köprü Bakım');
  });
});
