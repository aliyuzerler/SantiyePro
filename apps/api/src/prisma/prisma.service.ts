import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma erişim servisi.
 * - Phase 00: bağlantı yönetimi ve health kontrolü.
 * - Modeller ve migration'lar fazlarla birlikte eklenir (docs/04).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Veritabanı bağlantısı kuruldu');
    } catch (error) {
      // Faz 00'da DB olmadan API'nin boot edebilmesi beklenen bir durumdur;
      // readiness ucu durumu raporlar, süreç çökmez.
      this.logger.warn(
        `Veritabanı bağlantısı kurulamadı (readiness 'unavailable' dönecek): ${String(
          error instanceof Error ? error.message : error,
        )}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Basit ve hızlı bir bağlantı/doğrulama sorgusu. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
