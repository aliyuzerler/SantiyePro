/**
 * Medya kuyruğu boşaltıcı (Faz 09 — docs/09 fotoğraf senkronizasyonu).
 *
 * Akış: rapor metadata'sı ÖNCE push edilir (outbox accepted → targetReportId
 * eşlenir), sonra dosyalar upload URL ile yüklenir ve complete ile mühürlenir.
 * Upload ortasında bağlantı kesilirse: kayıt failed/pending kalır, yerel dosya
 * URI'si dokunulmaz — bağlantı gelince AYNI dosyadan retry edilir (test
 * senaryosu 5: dosya kaybolmadan retry). Kayıt 'Tam senkronize' ancak complete
 * + rapora bağlama başarılıysa gösterilir.
 *
 * Rapor-medya bağlaması: mevcut mediaIds listesi GET ile okunur, yeni medya ID
 * SONA EKLENİR — sunucudaki listeyi ezmez (başka cihazın eklediği foto korunur).
 */
import { dailyReportsApi, mediaApi } from '../api.js';
import type { SyncStorage, MediaQueueRow } from './types';
import { MAX_MEDIA_ATTEMPTS } from './types';

export function createMediaFlusher(storage: SyncStorage) {
  return async function flushMedia(token: string): Promise<{ uploaded: number; failed: number }> {
    const rows = await storage.listMedia();
    let uploaded = 0;
    let failed = 0;

    for (const row of rows) {
      if (row.status === 'done' || row.status === 'uploading') continue;
      // Rapor henüz sunucuda yoksa bekler — dosya yerelde güvende.
      if (!row.targetReportId) continue;
      if (row.attemptCount >= MAX_MEDIA_ATTEMPTS) continue;

      await storage.putMedia({ ...row, status: 'uploading' });
      try {
        const urlRes = await mediaApi.requestUploadUrl(token, {
          filename: `rapor-${row.clientMutationId.slice(0, 10)}.jpg`,
          mimeType: row.mimeType,
          sizeBytes: Math.max(1, row.sizeBytes),
          projectId: row.projectId,
        });
        // Kesinti burada olursa hata fırlar → satır pending/failed kalır;
        // dosya hâlâ localUri'de olduğu için retry AYNI dosyayı yükler.
        await mediaApi.uploadBinary(urlRes.uploadUrl, row.localUri);
        await mediaApi.complete(token, urlRes.mediaId);

        // Raporun güncel medya listesine EKLE (üzerine yazma).
        const detail = await dailyReportsApi.get(token, row.targetReportId);
        const existing = (detail.media ?? []).map((m) => m.id);
        await dailyReportsApi.update(token, row.targetReportId, {
          mediaIds: [...existing, urlRes.mediaId].slice(0, 20),
        });

        await storage.putMedia({
          ...row,
          status: 'done',
          attemptCount: row.attemptCount + 1,
          lastError: null,
        });
        uploaded += 1;
      } catch (error) {
        const attemptCount = row.attemptCount + 1;
        await storage.putMedia({
          ...row,
          status: attemptCount >= MAX_MEDIA_ATTEMPTS ? 'failed' : 'pending',
          attemptCount,
          lastError: error instanceof Error ? error.message : 'Dosya yüklenemedi',
        });
        failed += 1;
      }
    }
    return { uploaded, failed };
  };
}

/** Kuyruk ekranı için medya özeti. */
export async function mediaQueueSummary(storage: SyncStorage): Promise<{ waiting: number; failed: number; done: number }> {
  const rows = await storage.listMedia();
  return {
    waiting: rows.filter((r: MediaQueueRow) => r.status === 'pending' || r.status === 'uploading').length,
    failed: rows.filter((r: MediaQueueRow) => r.status === 'failed').length,
    done: rows.filter((r: MediaQueueRow) => r.status === 'done').length,
  };
}
