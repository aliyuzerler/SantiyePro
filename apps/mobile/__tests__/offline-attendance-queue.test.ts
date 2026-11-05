/**
 * Faz 06 mobil testleri — çevrimdışı puantaj kuyruğu (docs/09 yaklaşımı):
 * duplicate koruması (aynı personel/gün/vardiya tek bekleyen), yerel çakışma
 * bayrağı (durum değişince son yazılan kazanır), flush + deneme sayacı,
 * 409 duplicate 'done' sayılır, hydrate kalıcılık.
 */
import { describe, expect, it } from '@jest/globals';
import {
  InMemoryAttendanceQueueAdapter,
  MAX_ATTENDANCE_ATTEMPTS,
  OfflineAttendanceQueue,
  attendanceQueueKey,
} from '../src/lib/offline-attendance-queue';

function newQueue(): OfflineAttendanceQueue {
  return new OfflineAttendanceQueue(new InMemoryAttendanceQueueAdapter());
}

const BASE = {
  projectId: 'prj-1',
  personnelId: 'p-1',
  workDate: '2026-06-01',
  shiftKey: 'GUNDUZ',
};

describe('OfflineAttendanceQueue (Faz 06)', () => {
  it('enqueue: bekleyen kayıt ekler; anahtar personnel|proje|gün|vardiya bileşimidir', async () => {
    const queue = newQueue();
    const result = await queue.enqueue({
      clientMutationId: 'cm-1',
      ...BASE,
      attendanceStatus: 'PRESENT',
    });
    expect(result.hadConflict).toBe(false);
    expect(result.wasDuplicate).toBe(false);
    expect(result.item.status).toBe('pending');
    expect(result.item.hadConflict).toBe(false);
    expect(result.item.note).toBeNull();
    expect(attendanceQueueKey(BASE)).toBe('p-1|prj-1|2026-06-01|GUNDUZ');
    expect(queue.pendingCount()).toBe(1);
  });

  it('duplicate koruması: aynı işaretleme ikinci kez kuyruğa girmez', async () => {
    const queue = newQueue();
    await queue.enqueue({ clientMutationId: 'cm-1', ...BASE, attendanceStatus: 'PRESENT' });
    const second = await queue.enqueue({ clientMutationId: 'cm-2', ...BASE, attendanceStatus: 'PRESENT' });

    expect(second.wasDuplicate).toBe(true);
    expect(second.hadConflict).toBe(false);
    // Orijinal mutasyon korunur — yeni clientMutationId KULLANILMAZ
    expect(second.item.clientMutationId).toBe('cm-1');
    expect(queue.list()).toHaveLength(1);
  });

  it('yerel çakışma: durum değişince bekleyen kayıt yenisiyle değişir ve hadConflict işaretlenir', async () => {
    const queue = newQueue();
    await queue.enqueue({ clientMutationId: 'cm-1', ...BASE, attendanceStatus: 'PRESENT' });
    const second = await queue.enqueue({ clientMutationId: 'cm-2', ...BASE, attendanceStatus: 'ABSENT' });

    expect(second.hadConflict).toBe(true);
    expect(second.wasDuplicate).toBe(false);
    expect(second.item.clientMutationId).toBe('cm-2'); // son yazılan kazanır, yeni mutasyon
    expect(second.item.attendanceStatus).toBe('ABSENT');
    expect(second.item.hadConflict).toBe(true);

    // Kuyrukta hâlâ TEK bekleyen kayıt var (duplicate yok)
    expect(queue.list()).toHaveLength(1);
    expect(queue.retryable()[0]!.attendanceStatus).toBe('ABSENT');
  });

  it('farklı vardiya ayrı bekleyen kayıttır (docs/04 unique boyutlarıyla aynı)', async () => {
    const queue = newQueue();
    await queue.enqueue({ clientMutationId: 'cm-1', ...BASE, attendanceStatus: 'PRESENT' });
    await queue.enqueue({ clientMutationId: 'cm-2', ...BASE, shiftKey: 'GECE', attendanceStatus: 'PRESENT' });
    expect(queue.pendingCount()).toBe(2);
  });

  it('flush: gönderici başarılıysa kayıt kapanır; 409 duplicate de done sayılır', async () => {
    const queue = newQueue();
    await queue.enqueue({ clientMutationId: 'cm-1', ...BASE, attendanceStatus: 'PRESENT' });

    const sentBodies: string[] = [];
    const result = await queue.flush(async (item) => {
      sentBodies.push(item.clientMutationId);
      return true; // 201 veya 409 → sunucuda kayıt garantili
    });

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(sentBodies).toEqual(['cm-1']);
    expect(queue.list('done')).toHaveLength(1);
    expect(queue.pendingCount()).toBe(0);
  });

  it('flush: ağ hatasında deneme sayacı artar; MAX aşıldığında failed kalır', async () => {
    const queue = newQueue();
    await queue.enqueue({ clientMutationId: 'cm-1', ...BASE, attendanceStatus: 'PRESENT' });

    for (let i = 1; i <= MAX_ATTENDANCE_ATTEMPTS; i += 1) {
      const result = await queue.flush(async () => {
        throw new Error('ağ yok');
      });
      expect(result.failed).toBe(1);
    }

    const failed = queue.list('failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.attemptCount).toBe(MAX_ATTENDANCE_ATTEMPTS);
    expect(failed[0]!.lastError).toBe('ağ yok');
    // failed kayıtlar retryable'da yeniden denenmez (Faz 09 politika)
    expect(queue.retryable()).toHaveLength(0);
  });

  it('flush: sunucu reddi (false) deneme sayacını artırır ve lastError yazılır', async () => {
    const queue = newQueue();
    await queue.enqueue({ clientMutationId: 'cm-1', ...BASE, attendanceStatus: 'OZEL_DURUM' });
    const result = await queue.flush(async () => false);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    // Tek başarısızlık: kayıt hâlâ 'pending' (yeniden denenebilir), hata kayıtlı
    const pending = queue.list('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.lastError).toBe('Sunucu kaydı kabul etmedi');
    expect(pending[0]!.attemptCount).toBe(1);
  });

  it('hydrate: kalıcı adaptörden kayıtlar geri yüklenir', async () => {
    const adapter = new InMemoryAttendanceQueueAdapter();
    const first = new OfflineAttendanceQueue(adapter);
    await first.enqueue({ clientMutationId: 'cm-1', ...BASE, attendanceStatus: 'LEAVE' });

    const second = new OfflineAttendanceQueue(adapter);
    await second.hydrate();
    expect(second.pendingCount()).toBe(1);
    expect(second.list()[0]!.attendanceStatus).toBe('LEAVE');
  });

  it('clearDone: tamamlananlar temizlenir, bekleyenler korunur', async () => {
    const queue = newQueue();
    await queue.enqueue({ clientMutationId: 'cm-1', ...BASE, attendanceStatus: 'PRESENT' });
    await queue.enqueue({ clientMutationId: 'cm-2', ...BASE, personnelId: 'p-2', attendanceStatus: 'SICK' });
    await queue.flush(async () => true);
    expect(queue.list()).toHaveLength(2);
    await queue.clearDone();
    expect(queue.list()).toHaveLength(0);
  });
});
