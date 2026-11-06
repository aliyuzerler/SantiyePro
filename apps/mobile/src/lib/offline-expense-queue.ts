/**
 * Çevrimdışı gider kuyruğu (Faz 08, docs/09 yaklaşımı — stok kuyruğu deseni).
 *
 * Kurallar (prompts/phase-08-development.md, docs/09):
 * - Gider append-only/işlem bazlıdır; otomatik üzerine yazma yoktur.
 *   Bu yüzden stok kuyruğundan farklı olarak bekleyen kayıt DEĞİŞTİRİLMEZ:
 *   aynı clientMutationId'li kayıt tekrar kuyruğa alınırsa duplicate kabul
 *   edilir (çift gider oluşmaz), farklı içerik yeni kayıt olarak ayrı durur.
 * - Kesin kabul sunucu doğrulamasına bağlıdır: kategori/tutar/para birimi
 *   sunucuda yeniden doğrulanır; reddedilen kayıt 'done' sayılır ve hata
 *   mesajı kayıtta saklanır (tekrar gönderilmez).
 * - flush: gönderici fonksiyon enjekte edilir (tam senkronizasyon Faz 09);
 *   başarısızlıkta attemptCount artar, MAX'a ulaşan kayıt 'failed' kalır.
 */

/** Kuyruk yaşam döngüsü durumu. */
export type ExpenseQueueStatus = 'pending' | 'syncing' | 'failed' | 'done';

export interface PendingExpense {
  /** İstemci tarafından üretilen tekil anahtar — idempotency (docs/09). */
  clientMutationId: string;
  projectId: string;
  projectName: string;
  categoryId: string;
  categoryName: string;
  vendorName: string | null;
  description: string;
  /** Kanonik para string (2 ondalık). */
  amount: string;
  currency: string;
  /** OPSİYONEL — verilmezse sunucuda vergi uydurulmaz (null). */
  taxRate: string | null;
  /** YYYY-MM-DD. */
  expenseDate: string;
  /** Kuyruk yaşam döngüsü. */
  status: ExpenseQueueStatus;
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
}

export interface ExpenseQueuePersistenceAdapter {
  load(): Promise<PendingExpense[]>;
  save(items: PendingExpense[]): Promise<void>;
}

/** Testler ve Faz 08 kullanımı için bellek içi adaptör. */
export class InMemoryExpenseQueueAdapter implements ExpenseQueuePersistenceAdapter {
  private items: PendingExpense[] = [];

  async load(): Promise<PendingExpense[]> {
    return this.items.map((item) => ({ ...item }));
  }

  async save(items: PendingExpense[]): Promise<void> {
    this.items = items.map((item) => ({ ...item }));
  }
}

export interface EnqueueExpenseInput {
  clientMutationId: string;
  projectId: string;
  projectName: string;
  categoryId: string;
  categoryName: string;
  vendorName?: string | null;
  description: string;
  amount: string;
  currency: string;
  taxRate?: string | null;
  expenseDate: string;
}

/** Yeniden deneme politikası: bu sayıya ulaşan kayıt 'failed' kalır (Faz 09). */
export const MAX_EXPENSE_ATTEMPTS = 5;

export interface EnqueueExpenseResult {
  item: PendingExpense;
  /** true: aynı clientMutationId zaten kuyrukta bekliyordu (duplicate engellendi). */
  wasDuplicate: boolean;
}

export class OfflineExpenseQueue {
  private items: PendingExpense[] = [];

  constructor(private readonly adapter: ExpenseQueuePersistenceAdapter = new InMemoryExpenseQueueAdapter()) {}

  /** Kuyruğu kalıcı depodan yükler (uygulama açılışında). */
  async hydrate(): Promise<void> {
    this.items = await this.adapter.load();
  }

  private async persist(): Promise<void> {
    await this.adapter.save(this.items);
  }

  list(status?: ExpenseQueueStatus): PendingExpense[] {
    return this.items.filter((item) => (status ? item.status === status : true)).map((item) => ({ ...item }));
  }

  pendingCount(): number {
    return this.items.filter((item) => item.status === 'pending' || item.status === 'failed').length;
  }

  /**
   * Gider kuyruğa alınır. Aynı clientMutationId bekliyorsa duplicate kabul
   * edilir (append-only felsefe: bekleyen kayıt sessizce değiştirilmez).
   */
  async enqueue(input: EnqueueExpenseInput): Promise<EnqueueExpenseResult> {
    const existing = this.items.find(
      (item) => item.clientMutationId === input.clientMutationId && (item.status === 'pending' || item.status === 'failed'),
    );
    if (existing) {
      return { item: { ...existing }, wasDuplicate: true };
    }

    const item: PendingExpense = {
      clientMutationId: input.clientMutationId,
      projectId: input.projectId,
      projectName: input.projectName,
      categoryId: input.categoryId,
      categoryName: input.categoryName,
      vendorName: input.vendorName ?? null,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      taxRate: input.taxRate ?? null,
      expenseDate: input.expenseDate,
      status: 'pending',
      attemptCount: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    await this.persist();
    return { item: { ...item }, wasDuplicate: false };
  }

  /** Gönderim öncesi 'syncing' işaretler. */
  async markSyncing(clientMutationId: string): Promise<void> {
    await this.updateStatus(clientMutationId, 'syncing');
  }

  /** Sunucu kararı kesindir: 201 (kayıt oluştu) VE 400/409 (sunucu reddi) 'done'dur. */
  async markDone(clientMutationId: string, error?: string): Promise<void> {
    const item = this.items.find((i) => i.clientMutationId === clientMutationId);
    if (!item) return;
    this.items = this.items.map((i) =>
      i.clientMutationId === clientMutationId ? { ...i, status: 'done' as const, lastError: error ?? null } : i,
    );
    await this.persist();
  }

  /** Gönderim başarısızlığı (ağ vb.): deneme sayacını artırır; MAX'a ulaşan 'failed'. */
  async markFailed(clientMutationId: string, error: string): Promise<void> {
    const item = this.items.find((i) => i.clientMutationId === clientMutationId);
    if (!item) return;
    const attemptCount = item.attemptCount + 1;
    const status: ExpenseQueueStatus = attemptCount >= MAX_EXPENSE_ATTEMPTS ? 'failed' : 'pending';
    this.items = this.items.map((i) =>
      i.clientMutationId === clientMutationId ? { ...i, status, attemptCount, lastError: error } : i,
    );
    await this.persist();
  }

  private async updateStatus(clientMutationId: string, status: ExpenseQueueStatus): Promise<void> {
    this.items = this.items.map((i) => (i.clientMutationId === clientMutationId ? { ...i, status } : i));
    await this.persist();
  }

  /** 'done' kayıtlarını kuyruktan temizler (gösterim sonrası). */
  async clearDone(): Promise<void> {
    this.items = this.items.filter((i) => i.status !== 'done');
    await this.persist();
  }

  /**
   * Kuyruğu boşaltır: gönderici { ok: boolean; permanent: boolean; error?: string }
   * döner — permanent (sunucu reddi) 'done', geçici hata attemptCount artırır.
   */
  async flush(
    sender: (item: PendingExpense) => Promise<{ ok: boolean; permanent?: boolean; error?: string }>,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    const sendable = this.items.filter((i) => i.status === 'pending' || i.status === 'failed');
    for (const item of sendable) {
      await this.markSyncing(item.clientMutationId);
      try {
        const result = await sender(item);
        if (result.ok || result.permanent) {
          await this.markDone(item.clientMutationId, result.ok ? undefined : result.error);
          sent += 1;
        } else {
          await this.markFailed(item.clientMutationId, result.error ?? 'Sunucu kaydı kabul etmedi');
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
export const offlineExpenseQueue = new OfflineExpenseQueue();
