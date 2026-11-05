import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ReadinessResponse } from '@santiyepro/contracts';

export interface ReadinessResult {
  response: ReadinessResponse;
  httpStatus: 200 | 503;
}

/**
 * Health servis katmanı.
 * - Liveness: süreç ayakta (bağımlılıklara bakmaz).
 * - Readiness: veritabanı erişilebilir mi (docs/08 performans kuralları).
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  liveness() {
    return {
      status: 'ok' as const,
      service: 'santiyepro-api' as const,
      version: process.env.APP_VERSION ?? '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }

  /** DB erişilemezse 503 + 'unavailable' döner; exception yükseltmez (hata zarfı yerine sözleşme gövdesi). */
  async readiness(): Promise<ReadinessResult> {
    let database: ReadinessResponse['checks']['database'] = 'unavailable';
    try {
      await this.prisma.ping();
      database = 'ok';
    } catch {
      database = 'unavailable';
    }

    const response: ReadinessResponse = {
      status: database === 'ok' ? 'ok' : 'unavailable',
      checks: { database },
      timestamp: new Date().toISOString(),
    };

    if (database === 'unavailable') {
      return { response, httpStatus: 503 };
    }
    return { response, httpStatus: 200 };
  }
}
