/**
 * Stok hareketi uçları (Faz 07).
 *
 * İzinler (docs/06 "Stok hareketi" satırı):
 * - inventory.view: hareket geçmişi listeleme.
 * - inventory.move: hareket kaydetme ve ters kayıt.
 *
 * Append-only: hareket için PATCH/DELETE ucu YOKTUR — geçmiş hareket
 * fiziksel olarak değiştirilemez/silinemez; düzeltme yalnızca
 * POST /inventory/movements/:id/reverse ile ters kayıttır.
 */
import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  createMovementRequestSchema,
  movementListQuerySchema,
  reverseMovementRequestSchema,
  type CreateMovementRequest,
  type MovementListQuery,
  type ReverseMovementRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { StockService } from './stock.service.js';

@ApiTags('inventory')
@Controller('inventory/movements')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  @Get()
  @RequirePermissions('inventory.view')
  @ApiOperation({
    summary: 'Hareket geçmişi: proje/depo/malzeme/tip/tarih filtreleri + sayfalama (append-only kayıt)',
  })
  list(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(movementListQuerySchema)) query: MovementListQuery,
  ) {
    return this.stockService.list(userId ?? '', query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('inventory.move')
  @ApiOperation({
    summary:
      'Hareket kaydetme (IN/OUT/TRANSFER/RETURN/ADJUSTMENT): transfer tek transaction, negatif stok 409, clientMutationId idempotent',
  })
  create(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(createMovementRequestSchema)) body: CreateMovementRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.stockService.create(userId ?? '', body, this.meta(req, client));
  }

  @Post(':id/reverse')
  @HttpCode(201)
  @RequirePermissions('inventory.move')
  @ApiOperation({
    summary: 'Ters kayıt: orijinalin bakiye etkisini geri alır (tek transaction); bir hareket en fazla bir kez ters kaydedilir',
  })
  reverse(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reverseMovementRequestSchema)) body: ReverseMovementRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.stockService.reverse(userId ?? '', id, body, this.meta(req, client));
  }
}
