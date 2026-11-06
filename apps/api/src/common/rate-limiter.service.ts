import { Injectable } from '@nestjs/common';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  attempts: number;
}

/**
 * Basit in-memory kayan pencere rate limiter (docs/07: login denemelerine rate limit
 * ve artan gecikme). Tek müşteri kurulumu ve Faz 02 kapsamı için yeterlidir;
 * çoklu örnek dağıtımında Redis tabanlıya geçilecek (Faz 11 sertleştirme notu).
 *
 * Faz 11 sertleştirmesi: anahtar havuzu MAX_TRACKED_KEYS ile sınırlıdır; sınır
 * aşılırsa en eski kayıtlar atılır (Map ekleme sırası korunur). Böylece saldırgan
 * farklı IP/e-posta kombinasyonlarıyla belleği şişiremez.
 */
@Injectable()
export class RateLimiterService {
  /** Takip edilen maksimum anahtar sayısı (bellek sınırı). */
  private static readonly MAX_TRACKED_KEYS = 10_000;
  private readonly attempts = new Map<string, number[]>();

  /**
   * Bir deneme kaydeder ve limit aşılırsa reddeder.
   * limit: windowMs içinde izin verilen deneme sayısı.
   */
  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const list = this.attempts.get(key) ?? [];
    const recent = list.filter((t) => now - t < windowMs);
    recent.push(now);
    this.attempts.set(key, recent);
    this.evictIfNeeded();

    if (recent.length > limit) {
      const oldest = recent[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      return { allowed: false, retryAfterSeconds, attempts: recent.length };
    }
    return { allowed: true, retryAfterSeconds: 0, attempts: recent.length };
  }

  /** Başarılı girişten sonra e-posta kuyruğunu sıfırlar. */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  /** Test ve bakım için. */
  clear(): void {
    this.attempts.clear();
  }

  /** Bellek sınırı: anahtar sayısı MAX_TRACKED_KEYS aşarsa en eski kayıtlar atılır. */
  private evictIfNeeded(): void {
    while (this.attempts.size > RateLimiterService.MAX_TRACKED_KEYS) {
      const oldestKey = this.attempts.keys().next().value;
      if (oldestKey === undefined) break;
      this.attempts.delete(oldestKey);
    }
  }
}
