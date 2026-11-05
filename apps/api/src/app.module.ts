import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

/**
 * Modüler monolit kök modülü (ADR-002).
 * Faz 00 yalnızca iskelet: health + prisma altyapısı.
 * Auth, users, projects vb. modüller sonraki fazlarda eklenir.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
