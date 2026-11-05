/**
 * Çevrimdışı stok hareketi kuyruğu (Faz 07, docs/09 yaklaşımı).
 *
 * Geliştirme promptu: "Offline cihazdaki son bilinen stok uyarı olarak
 * gösterilir; kesin kabul sunucu doğrulamasına bağlıdır" + "clientMutationId
 * duplicate hareketi engeller". Kurallar:
 * - Kuyruk anahtarı: malzeme | depo | tip. Aynı anahtar için TEK bekleyen
 *   hareket vardır; farklı miktarda yeni hareket gelirse bekleyeni DEĞİŞTİRİR
 *   (son yazılan kazanır) ve yeni clientMutationId alır — eski mutasyon
 *   sunucuya hiç gitmezse çift hareket oluşmaz; gittiyse API idempotency +
 *   negatif stok 409 ile korunur.
 * - hadConflict bayrağı arayüzde "kuyruktaki hareket değiştirildi" göstergesi
 *   içindir (yerel çakışma bilgisi kaybolmaz).
 * - Negatif stok YERELDE kabul edilir: cihaz yalnızca son bilinen bakiyeyi
 *   görür; reddetme yetkisi sunucudadır (kesin kabul sunucu doğrulamasıdır).
 * - flush: gönderici fonksiyon enjekte edilir (tam senkronizasyon Faz 09);
 *   başarısızlıkta attemptCount artar, MAX'a ulaşan kayıt 'failed' kalır.
 */

/** Kuyruk yaşam döngüsü durumu. */
export type StockQueueStatus = 'pending' | 'syncing' | 'failed' | 'done';

export interface PendingStockMovement {
  /** İstemci tarafından üretilen tekil anahtar — idempotency (docs/09). */
  clientMutationId: string;
  type: 'IN' | 'OUT' | 'TRANSFER' | 'RETURN' | 'ADJUSTMENT';
  materialId: string;
  materialName: string;
  warehouseId: string;
  warehouseName: string;
  targetWarehouseId: string | null;
  /** Kanonik ondalık string; ADJUSTMENT işaretli olabilir. */
  quantity: string;
  unit: string;
  note: string | null;
  /** Kuyruk yaşam döngüsü. */
  status: StockQueueStatus;
  attemptCount: number;
  lastError: string | null;
  /** Yerel çakışma: aynı anahtar için bekleyen hareket değiştirildi. */
  hadConflict: boolean;
  createdAt: string;
}

export interface StockQueuePersistenceAdapter {
  load(): Promise<PendingStockMovement[]>;
  save(items: PendingStockMovement[]): Promise<void>;
}

/** Testler ve Faz 07 kullanımı için bellek içi adaptör. */
export class InMemoryStockQueueAdapter implements StockQueuePersistenceAdapter {
  private items: PendingStockMovement[] = [];

  async load(): Promise<PendingStockMovement[]> {
    return this.items.map((item) => ({ ...item }));
  }

  async save(items: PendingStockMovement[]): Promise<void> {
    this.items = items.map((item) => ({ ...item }));
  }
}

export interface EnqueueStockInput {
  clientMutationId: string;
  type: 'IN' | 'OUT' | 'TRANSFER' | 'RETURN' | 'ADJUSTMENT';
  materialId: string;
  materialName: string;
  warehouseId: string;
  warehouseName: string;
  targetWarehouseId: string | null;
  quantity: string;
  unit: string;
  note?: string | null;
}

/** Kuyruk anahtarı: aynı malzeme/depo/tip için tek bekleyen hareket. */
export function stockQueueKey(
  item: Pick<EnqueueStockInput, 'materialId' | 'warehouseId' | 'type'>,
): string {
  return `${item.materialId}|${item.warehouseId}|${item.type}`;
}

/** Yeniden deneme politikası: bu sayıya ulaşan kayıt 'failed' kalır (Faz 09). */
export const MAX_STOCK_ATTEMPTS = 5;

export interface EnqueueStockResult {
  item: PendingStockMovement;
  /** true: aynı anahtar için bekleyen hareket değiştirildi (yerel çakışma). */
  hadConflict: boolean;
  /** true: aynı hareket zaten kuyrukta bekliyordu (duplicate engellendi). */
  wasDuplicate: boolean;
}

export class OfflineStockQueue {
  private items: PendingStockMovement[] = [];

  constructor(private readonly adapter: StockQueuePersistenceAdapter = new InMemoryStockQueueAdapter()) {}

  /** Kuyruğu kalıcı depodan yükler (uygulama açılışında). */
  async hydrate(): Promise<void> {
    this.items = await this.adapter.load();
  }

  private async persist(): Promise<void> {
    await this.adapter.save(this.items);
  }

  list(status?: StockQueueStatus): PendingStockMovement[] {
    return this.items.filter((item) => (status ? item.status === status : true)).map((item) => ({ ...item }));
  }

  pendingCount(): number {
    return this.items.filter((item) => item.status === 'pending' || item.status === 'failed').length;
  }

  /** Anahtar için bekleyen hareketi verir (varsa). */
  findPending(input: Pick<EnqueueStockInput, 'materialId' | 'warehouseId' | 'type'>): PendingStockMovement | null {
    const key = stockQueueKey(input);
    const found = this.items.find(
      (item) => stockQueueKey(item) === key && (item.status === 'pending' || item.status === 'failed'),
    );
    return found ? { ...found } : null;
  }

  /**
   * Hareket kuyruğa alınır. Aynı anahtar (malzeme/depo/tip) için bekleyen
   * hareket varsa: miktar ve hedef aynıysa duplicate kabul edilir (çift kayıt
   * yok); farklıysa bekleyen kayıt yenisiyle değiştirilir (son yazılan kazanır),
   * yeni clientMutationId alınır ve hadConflict işaretlenir.
   */
  async enqueue(input: EnqueueStockInput): Promise<EnqueueStockResult> {
    const key = stockQueueKey(input);
    const existing = this.items.find(
      (item) => stockQueueKey(item) === key && (item.status === 'pending' || item.status === 'failed'),
    );

    if (
      existing &&
      existing.quantity === input.quantity &&
      (existing.targetWarehouseId ?? null) === (input.targetWarehouseId ?? null)
    ) {
      return { item: { ...existing }, hadConflict: false, wasDuplicate: true };
    }

    const item: PendingStockMovement = {
      clientMutationId: input.clientMutationId,
      type: input.type,
      materialId: input.materialId,
      materialName: input.materialName,
      warehouseId: input.warehouseId,
      warehouseName: input.warehouseName,
      targetWarehouseId: input.targetWarehouseId ?? null,
      quantity: input.quantity,
      unit: input.unit,
      note: input.note ?? null,
      status: 'pending',
      attemptCount: 0,
      lastError: null,
      hadConflict: Boolean(existing),
      createdAt: new Date().toISOString(),
    };

    if (existing) {
      const existingIndex = this.items.findIndex((i) => i === existing);
      this.items[existingIndex] = item;
    } else {
      this.items.push(item);
    }
    await this.persist();
    return { item: { ...item }, hadConflict: Boolean(existing), wasDuplicate: false };
  }

  /** Gönderim öncesi 'syncing' işaretler. */
  async markSyncing(clientMutationId: string): Promise<void> {
    await this.updateStatus(clientMutationId, 'syncing');
  }

  /** Sunucu onayı: kuyruktan kapatır. 409 (negatif stok/duplicate) da 'done'dur:
   *  kayıt sunucuda vardır ya da sunucu kararı kesindir — tekrar gönderilmez. */
  async markDone(clientMutationId: string): Promise<void> {
    await this.updateStatus(clientMutationId, 'done');
  }

  /** Gönderim başarısızlığı: deneme sayacını artırır; MAX'a ulaşan 'failed'. */
  async markFailed(clientMutationId: string, error: string): Promise<void> {
    const item = this.items.find((i) => i.clientMutationId === clientMutationId);
    if (!item) return;
    const attemptCount = item.attemptCount + 1;
    const status: StockQueueStatus = attemptCount >= MAX_STOCK_ATTEMPTS ? 'failed' : 'pending';
    this.items = this.items.map((i) =>
      i.clientMutationId === clientMutationId ? { ...i, status, attemptCount, lastError: error } : i,
    );
    await this.persist();
  }

  private async updateStatus(clientMutationId: string, status: StockQueueStatus): Promise<void> {
    this.items = this.items.map((i) => (i.clientMutationId === clientMutationId ? { ...i, status } : i));
    await this.persist();
  }

  /** 'done' kayıtlarını kuyruktan temizler (başarılı gönderim sonrası). */
  async clearDone(): Promise<void> {
    this.items = this.items.filter((i) => i.status !== 'done');
    await this.persist();
  }

  /**
   * Kuyruğu boşaltır: 'pending'/'failed' kayıtları gönderici fonksiyonla
   * sunucuya yazar. Gönderici sunucu sonucunu boolean ile bildirir; 409
   * (negatif stok/duplicate) da 'done' sayılır — sunucu kararı kesindir,
   * kayıt tekrar gönderilmez. Başarısızlıkta attemptCount artar.
   */
  async flush(sender: (item: PendingStockMovement) => Promise<boolean>): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    const sendable = this.items.filter((i) => i.status === 'pending' || i.status === 'failed');
    for (const item of sendable) {
      await this.markSyncing(item.clientMutationId);
      try {
        const ok = await sender(item);
        if (ok) {
          await this.markDone(item.clientMutationId);
          sent += 1;
        } else {
          await this.markFailed(item.clientMutationId, 'Sunucu kaydı kabul etmedi');
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        await this.markFailed(item.clientMutationId, error instanceof Error ? error.message : 'gönderilemedi');
      }
    }
    return { sent, failed };
  }
}

/** Uygulama geneli tek kuyruk örneği (Faz 09'da kalıcı adaptör bağlanır). */
export const offlineStockQueue = new OfflineStockQueue();
