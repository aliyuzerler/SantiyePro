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
 */
@Injectable()
export class RateLimiterService {
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
}
