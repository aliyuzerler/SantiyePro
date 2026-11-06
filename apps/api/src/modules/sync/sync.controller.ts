/**
 * Senkronizasyon uçları (Faz 09 — docs/05 Sync grubu).
 *
 * - POST /sync/push: çevrimdışı outbox batch'i; her mutation için
 *   accepted/rejected/conflict sonucu (idempotent — clientMutationId).
 * - GET /sync/pull: seq cursor'ıyla delta; kapsam dışı veri gönderilmez,
 *   accessibleProjectIds snapshot'ı ile erişimi kalkan proje bildirilir.
 *
 * Uçlar yalnızca kimlik doğrulaması ister (JwtAuthGuard global); nesne/izin
 * seviyesi kontroller push dispatch'inde gerçek servislerin içinde uygulanır —
 * böylece senkronizasyon yolu, doğrudan REST ucuyla asla daha yetkili olamaz.
 */
import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  syncPullQuerySchema,
  syncPushRequestSchema,
  type SyncPullQuery,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@santiyepro/contracts';
import { ClientInfo, CurrentUser, type ClientMeta } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { SyncService, type RequestMeta } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  private meta(req: Request, client: ClientMeta): RequestMeta {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as Request & { traceId?: string }).traceId };
  }

  @Post('push')
  async push(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(syncPushRequestSchema)) body: SyncPushRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ): Promise<SyncPushResponse> {
    return this.sync.push(userId ?? '', body, this.meta(req, client));
  }

  @Get('pull')
  async pull(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(syncPullQuerySchema)) query: SyncPullQuery,
  ): Promise<SyncPullResponse> {
    return this.sync.pull(userId ?? '', query);
  }
}
