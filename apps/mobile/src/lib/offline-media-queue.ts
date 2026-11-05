/**
 * Çevrimdışı medya kuyruğu — temel veri yapısı (Faz 05, docs/09).
 *
 * Tam senkronizasyon Faz 09'da uygulanacak; bu fazda veri yapısı, durum makinesi
 * ve kalıcılık arayüzü hazırlanır. Alanlar docs/09 media_queue tanımına uyar:
 * yerel dosya URI, hedef ilişki (rapor), upload status; clientMutationId
 * Faz 09 outbox'uyla birebir eşleşir (çift kayıt engeli).
 *
 * Kalıcılık: PersistenceAdapter arayüzü üzerinden — mobilde gerçek depolama
 * (expo-file-system/SQLite) Faz 09'da bağlanır; testler bellek içi adaptörle koşar.
 */

export type PendingMediaStatus = 'pending' | 'uploading' | 'failed' | 'done';

export interface PendingMediaUpload {
  /** İstemci tarafından üretilen tekil anahtar — idempotency (docs/09). */
  clientMutationId: string;
  /** Yerel dosya URI'si (image-picker asset uri vb.). */
  localUri: string;
  /** Hedef ilişki: eklenecek günlük rapor (henüz oluşturulmadıysa null). */
  targetReportId: string | null;
  mimeType: string;
  sizeBytes: number;
  status: PendingMediaStatus;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
}

export interface MediaQueuePersistenceAdapter {
  load(): Promise<PendingMediaUpload[]>;
  save(items: PendingMediaUpload[]): Promise<void>;
}

/** Testler ve Faz 05 kullanımı için bellek içi adaptör. */
export class InMemoryMediaQueueAdapter implements MediaQueuePersistenceAdapter {
  private items: PendingMediaUpload[] = [];

  async load(): Promise<PendingMediaUpload[]> {
    return this.items.map((item) => ({ ...item }));
  }

  async save(items: PendingMediaUpload[]): Promise<void> {
    this.items = items.map((item) => ({ ...item }));
  }
}

export interface EnqueueMediaInput {
  clientMutationId: string;
  localUri: string;
  targetReportId: string | null;
  mimeType: string;
  sizeBytes: number;
}

/** Yeniden deneme politikası: bu sayıya ulaşan kayıt 'failed' kalır (Faz 09'da yapılandırılabilir). */
export const MAX_UPLOAD_ATTEMPTS = 5;

export class OfflineMediaQueue {
  private items: PendingMediaUpload[] = [];

  constructor(private readonly adapter: MediaQueuePersistenceAdapter = new InMemoryMediaQueueAdapter()) {}

  /** Kuyruğu kalıcı depodan yükler (uygulama açılışında). */
  async hydrate(): Promise<void> {
    this.items = await this.adapter.load();
  }

  private async persist(): Promise<void> {
    await this.adapter.save(this.items);
  }

  list(status?: PendingMediaStatus): PendingMediaUpload[] {
    return this.items.filter((item) => (status ? item.status === status : true)).map((item) => ({ ...item }));
  }

  pendingCount(): number {
    return this.items.filter((item) => item.status === 'pending' || item.status === 'failed').length;
  }

  /** Yeni bekleyen yükleme ekler. */
  async enqueue(input: EnqueueMediaInput): Promise<PendingMediaUpload> {
    const item: PendingMediaUpload = {
      clientMutationId: input.clientMutationId,
      localUri: input.localUri,
      targetReportId: input.targetReportId,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: 'pending',
      attemptCount: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    await this.persist();
    return { ...item };
  }

  async markUploading(clientMutationId: string): Promise<void> {
    await this.update(clientMutationId, { status: 'uploading', lastError: null });
  }

  /** Yükleme başarısında kuyruktan kapatır. */
  async markDone(clientMutationId: string): Promise<void> {
    await this.update(clientMutationId, { status: 'done' });
  }

  /**
   * Yükleme başarısızlığında deneme sayacını artırır; deneme hakkı biten
   * 'failed' kalır (rapor metni zaten sunucuda taslak olarak güvendedir).
   */
  async markFailed(clientMutationId: string, error: string): Promise<void> {
    const item = this.items.find((i) => i.clientMutationId === clientMutationId);
    if (!item) return;
    const attemptCount = item.attemptCount + 1;
    const status: PendingMediaStatus = attemptCount >= MAX_UPLOAD_ATTEMPTS ? 'failed' : 'pending';
    await this.update(clientMutationId, { attemptCount, status, lastError: error });
  }

  /** 'pending' durumundaki kayıtları verir (bağlantı geri geldiğinde boşaltılır — Faz 09). */
  retryable(): PendingMediaUpload[] {
    return this.items
      .filter((item) => item.status === 'pending' && item.attemptCount < MAX_UPLOAD_ATTEMPTS)
      .map((item) => ({ ...item }));
  }

  /** Tamamlananları temizler (yer açmak için). */
  async clearDone(): Promise<void> {
    this.items = this.items.filter((item) => item.status !== 'done');
    await this.persist();
  }

  private async update(clientMutationId: string, patch: Partial<PendingMediaUpload>): Promise<void> {
    this.items = this.items.map((item) =>
      item.clientMutationId === clientMutationId ? { ...item, ...patch } : item,
    );
    await this.persist();
  }
}

/** Uygulama geni tek kuyruk örneği (Faz 09'da kalıcı adaptör bağlanacak). */
export const offlineMediaQueue = new OfflineMediaQueue(new InMemoryMediaQueueAdapter());

/** clientMutationId üretimi (rnotilde crypto yoksa rastgele bayt dizisi). */
export function generateClientMutationId(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
