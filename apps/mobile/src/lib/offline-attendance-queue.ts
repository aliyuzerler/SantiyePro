/**
 * Çevrimdışı puantaj kuyruğu (Faz 06, docs/09 yaklaşımı).
 *
 * Test promptu: "Mobile offline kayıt hazırlanırken duplicate/local conflict
 * koruması". Kurallar:
 * - Aynı (personnel, proje, gün, vardiya) anahtarı için kuyrukta TEK bekleyen
 *   kayıt olur: durumu farklı yeni işaretleme mevcut bekleyeni DEĞİŞTİRİR
 *   (son yazılan kazanır) ve yeni clientMutationId alır — eski mutasyon
 *   sunucuya hiç gitmezse çift kayıt oluşmaz, gittiyse API idempotency +
 *   duplicate 409 ile korunur.
 * - Bekleyen kayıttan durumu farklı bir işaretleme gelirse `hadConflict: true`
   döner: arayüz kullanıcıya "kuyruktaki işaretleme değiştirildi" göstergesi
 *   için bayrak taşır (yerel çakışma bilgisi kaybolmaz).
 * - flush: gönderici fonksiyon enjekte edilir (tam senkronizasyon Faz 09);
 *   başarısızlıkta attemptCount artar, MAX'a ulaşan kayıt 'failed' kalır.
 *   409 (duplicate) da 'done' sayılır: kayıt sunucuda zaten vardır.
 * - GPS alanı YOKTUR: kuyruk yapısı konum toplamaz (docs/07).
 */

/** Kuyruk yaşam döngüsü durumu. */
export type QueueStatus = 'pending' | 'syncing' | 'failed' | 'done';

export interface PendingAttendanceMark {
  /** İstemci tarafından üretilen tekil anahtar — idempotency (docs/09). */
  clientMutationId: string;
  projectId: string;
  personnelId: string;
  /** YYYY-MM-DD takvim günü. */
  workDate: string;
  shiftKey: string;
  /** İşaretlenen devam durumu (PRESENT, ABSENT, kurum özel anahtarı…). */
  attendanceStatus: string;
  note: string | null;
  /** Kuyruk yaşam döngüsü. */
  status: QueueStatus;
  attemptCount: number;
  lastError: string | null;
  /** Yerel çakışma: aynı anahtar için daha önce farklı durum bekliyordu. */
  hadConflict: boolean;
  createdAt: string;
}

export interface AttendanceQueuePersistenceAdapter {
  load(): Promise<PendingAttendanceMark[]>;
  save(items: PendingAttendanceMark[]): Promise<void>;
}

/** Testler ve Faz 06 kullanımı için bellek içi adaptör. */
export class InMemoryAttendanceQueueAdapter implements AttendanceQueuePersistenceAdapter {
  private items: PendingAttendanceMark[] = [];

  async load(): Promise<PendingAttendanceMark[]> {
    return this.items.map((item) => ({ ...item }));
  }

  async save(items: PendingAttendanceMark[]): Promise<void> {
    this.items = items.map((item) => ({ ...item }));
  }
}

export interface EnqueueAttendanceInput {
  clientMutationId: string;
  projectId: string;
  personnelId: string;
  workDate: string;
  shiftKey: string;
  attendanceStatus: string;
  note?: string | null;
}

/** Kuyruk anahtarı: duplicate korumasının temeli (API unique ile aynı boyutlar). */
export function attendanceQueueKey(
  item: Pick<EnqueueAttendanceInput, 'personnelId' | 'projectId' | 'workDate' | 'shiftKey'>,
): string {
  return `${item.personnelId}|${item.projectId}|${item.workDate}|${item.shiftKey}`;
}

/** Yeniden deneme politikası: bu sayıya ulaşan kayıt 'failed' kalır (Faz 09). */
export const MAX_ATTENDANCE_ATTEMPTS = 5;

export interface EnqueueAttendanceResult {
  item: PendingAttendanceMark;
  /** true: aynı anahtar için bekleyen kayıt değiştirildi (yerel çakışma). */
  hadConflict: boolean;
  /** true: aynı işaretleme zaten kuyrukta bekliyordu (duplicate engellendi). */
  wasDuplicate: boolean;
}

export class OfflineAttendanceQueue {
  private items: PendingAttendanceMark[] = [];

  constructor(private readonly adapter: AttendanceQueuePersistenceAdapter = new InMemoryAttendanceQueueAdapter()) {}

  /** Kuyruğu kalıcı depodan yükler (uygulama açılışında). */
  async hydrate(): Promise<void> {
    this.items = await this.adapter.load();
  }

  private async persist(): Promise<void> {
    await this.adapter.save(this.items);
  }

  list(status?: QueueStatus): PendingAttendanceMark[] {
    return this.items.filter((item) => (status ? item.status === status : true)).map((item) => ({ ...item }));
  }

  pendingCount(): number {
    return this.items.filter((item) => item.status === 'pending' || item.status === 'failed').length;
  }

  /** Anahtar için bekleyen kaydı verir (varsa). */
  findPending(
    input: Pick<EnqueueAttendanceInput, 'personnelId' | 'projectId' | 'workDate' | 'shiftKey'>,
  ): PendingAttendanceMark | null {
    const key = attendanceQueueKey(input);
    const found = this.items.find(
      (item) => attendanceQueueKey(item) === key && (item.status === 'pending' || item.status === 'failed'),
    );
    return found ? { ...found } : null;
  }

  /**
   * İşaretleme kuyruğa alınır. Aynı anahtar için bekleyen kayıt varsa:
   * - durum aynıysa kayıt değiştirilmez (duplicate koruması),
   * - durum farklıysa bekleyen kayıt yenisiyle değiştirilir (son yazılan kazanır),
   *   yeni clientMutationId alınır ve hadConflict işaretlenir.
   */
  async enqueue(input: EnqueueAttendanceInput): Promise<EnqueueAttendanceResult> {
    const key = attendanceQueueKey(input);
    const existing = this.items.find(
      (item) => attendanceQueueKey(item) === key && (item.status === 'pending' || item.status === 'failed'),
    );

    if (existing) {
      if (existing.attendanceStatus === input.attendanceStatus) {
        // Aynı işaretleme zaten bekliyor — çift kayıt yok.
        return { item: { ...existing }, hadConflict: false, wasDuplicate: true };
      }
      const conflicted: PendingAttendanceMark = {
        clientMutationId: input.clientMutationId,
        projectId: input.projectId,
        personnelId: input.personnelId,
        workDate: input.workDate,
        shiftKey: input.shiftKey,
        attendanceStatus: input.attendanceStatus,
        note: input.note ?? null,
        status: 'pending',
        attemptCount: 0,
        lastError: null,
        hadConflict: true,
        createdAt: new Date().toISOString(),
      };
      const existingIndex = this.items.findIndex((item) => item === existing);
      this.items[existingIndex] = conflicted;
      await this.persist();
      return { item: { ...conflicted }, hadConflict: true, wasDuplicate: false };
    }

    const item: PendingAttendanceMark = {
      clientMutationId: input.clientMutationId,
      projectId: input.projectId,
      personnelId: input.personnelId,
      workDate: input.workDate,
      shiftKey: input.shiftKey,
      attendanceStatus: input.attendanceStatus,
      note: input.note ?? null,
      status: 'pending',
      attemptCount: 0,
      lastError: null,
      hadConflict: false,
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    await this.persist();
    return { item: { ...item }, hadConflict: false, wasDuplicate: false };
  }

  /** Gönderim öncesi 'syncing' işaretler. */
  async markSyncing(clientMutationId: string): Promise<void> {
    await this.updateStatus(clientMutationId, 'syncing');
  }

  /** Sunucu onayı: kuyruktan kapatır. */
  async markDone(clientMutationId: string): Promise<void> {
    await this.updateStatus(clientMutationId, 'done');
  }

  /** Gönderim başarısızlığı: deneme sayacını artırır; MAX'a ulaşan 'failed'. */
  async markFailed(clientMutationId: string, error: string): Promise<void> {
    const item = this.items.find((i) => i.clientMutationId === clientMutationId);
    if (!item) return;
    const attemptCount = item.attemptCount + 1;
    const status: QueueStatus = attemptCount >= MAX_ATTENDANCE_ATTEMPTS ? 'failed' : 'pending';
    this.items = this.items.map((i) =>
      i.clientMutationId === clientMutationId ? { ...i, status, attemptCount, lastError: error } : i,
    );
    await this.persist();
  }

  /** 'pending' kayıtları verir (bağlantı geri geldiğinde boşaltılır). */
  retryable(): PendingAttendanceMark[] {
    return this.items
      .filter((item) => item.status === 'pending' && item.attemptCount < MAX_ATTENDANCE_ATTEMPTS)
      .map((item) => ({ ...item }));
  }

  /**
   * Kuyruğu boşaltır: her kayıt için enjekte edilmiş gönderici çağrılır.
   * Gönderici sunucu sonucunu boolean ile bildirir; 409 (duplicate) da
   * 'done' sayılır — kayıt sunucuda zaten vardır, çift yazılmaz.
   */
  async flush(sender: (item: PendingAttendanceMark) => Promise<boolean>): Promise<{ sent: number; failed: number }> {
    const batch = this.retryable();
    let sent = 0;
    let failed = 0;
    for (const item of batch) {
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
        await this.markFailed(item.clientMutationId, error instanceof Error ? error.message : 'Bilinmeyen hata');
        failed += 1;
      }
    }
    return { sent, failed };
  }

  /** Tamamlananları temizler (yer açmak için). */
  async clearDone(): Promise<void> {
    this.items = this.items.filter((item) => item.status !== 'done');
    await this.persist();
  }

  private async updateStatus(clientMutationId: string, status: QueueStatus): Promise<void> {
    this.items = this.items.map((item) =>
      item.clientMutationId === clientMutationId ? { ...item, status, lastError: null } : item,
    );
    await this.persist();
  }
}

/** Uygulama geni tek kuyruk örneği (Faz 09'da kalıcı adaptör bağlanacak). */
export const offlineAttendanceQueue = new OfflineAttendanceQueue(new InMemoryAttendanceQueueAdapter());
