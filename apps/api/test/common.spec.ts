import { describe, expect, it, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { RateLimiterService } from '../src/common/rate-limiter.service.js';
import { maskSensitive } from '../src/common/audit.service.js';
import { securityHeadersMiddleware } from '../src/common/security-headers.middleware.js';
import { passwordSchema, loginRequestSchema } from '@santiyepro/contracts';

describe('RateLimiterService', () => {
  let limiter: RateLimiterService;
  beforeEach(() => {
    limiter = new RateLimiterService();
  });

  it('limit aşılana kadar izin verir, sonra reddeder', () => {
    for (let i = 0; i < 5; i++) {
      expect(limiter.consume('k', 5, 60_000).allowed).toBe(true);
    }
    const blocked = limiter.consume('k', 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('reset başarılı girişte kuyruğu temizler', () => {
    for (let i = 0; i < 5; i++) limiter.consume('k', 5, 60_000);
    limiter.reset('k');
    expect(limiter.consume('k', 5, 60_000).allowed).toBe(true);
  });

  it('pencere dışındaki denemeler sayılmaz', () => {
    const limiter2 = new RateLimiterService();
    // Pencereyi negatif süreyle simüle et: geçmiş kayıtlar filtrelenir
    for (let i = 0; i < 5; i++) limiter2.consume('x', 5, -1);
    expect(limiter2.consume('x', 5, 60_000).allowed).toBe(true);
  });

  // Faz 11: bellek sınırı — anahtar havuzu taşarsa en eski kayıt atılır.
  it('anahtar havuzu MAX_TRACKED_KEYS aşınca en eski anahtarları evict eder', () => {
    const max = 10_000;
    for (let i = 0; i < max + 50; i++) {
      limiter.consume(`key-${i}`, 1, 60_000);
    }
    // Havuz sınırlı kalmalı: key-0..49 atılmış olmalı.
    expect(limiter.consume('key-0', 1, 60_000).allowed).toBe(true); // evict edildi → taze başlangıç
    // Yeni denemeler devam edebilmeli (servis çalışır durumda).
    expect(limiter.consume('key-0', 1, 60_000).allowed).toBe(false); // ikinci deneme limitte
  });
});

describe('güvenlik başlıkları (Faz 11)', () => {
  function mockRes(): Response {
    const headers = new Map<string, string>();
    return {
      setHeader: (k: string, v: string) => {
        headers.set(k.toLowerCase(), v);
        return undefined as unknown as Response;
      },
      getHeader: (k: string) => headers.get(k.toLowerCase()),
    } as unknown as Response;
  }

  it('tüm sertleştirme başlıklarını yazar', () => {
    const res = mockRes();
    securityHeadersMiddleware({} as Request, res, () => undefined);
    expect(res.getHeader('x-content-type-options')).toBe('nosniff');
    expect(res.getHeader('x-frame-options')).toBe('DENY');
    expect(res.getHeader('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.getHeader('x-dns-prefetch-control')).toBe('off');
    expect(res.getHeader('permissions-policy')).toContain('camera=()');
    expect(res.getHeader('cross-origin-resource-policy')).toBe('same-site');
  });
});

describe('audit maskeleme', () => {
  it('hassas alanları before/after gövdelerinden çıkarır', () => {
    const masked = maskSensitive({
      password: 'gizli',
      passwordHash: 'hash',
      token: 'abc',
      refreshToken: 'xyz',
      accessToken: 'a.b.c',
      email: 'a@b.t',
      roles: ['FIRM_ADMIN'],
      nested: { setupToken: 'secret', status: 'ACTIVE' },
    });
    expect(JSON.stringify(masked)).not.toContain('gizli');
    expect(JSON.stringify(masked)).not.toContain('abc');
    expect(JSON.stringify(masked)).not.toContain('xyz');
    expect(JSON.stringify(masked)).not.toContain('secret');
    expect(JSON.stringify(masked)).toContain('a@b.t');
    expect(JSON.stringify(masked)).toContain('ACTIVE');
  });
});

describe('parola politikası (contracts)', () => {
  it('10 karakter altını, karmaşıklıksızları reddeder', () => {
    expect(passwordSchema.safeParse('kisa1A').success).toBe(false);
    expect(passwordSchema.safeParse('sadeceküçükharfler1').success).toBe(false);
    expect(passwordSchema.safeParse('SADECEBUYUKHARF1').success).toBe(false);
    expect(passwordSchema.safeParse('rakkamyokAa').success).toBe(false);
    expect(passwordSchema.safeParse('GucluParola123').success).toBe(true);
  });

  it('login şeması e-posta formatını doğrular', () => {
    expect(loginRequestSchema.safeParse({ email: 'gecersiz', password: 'x' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
  });
});
