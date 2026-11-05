/**
 * Personel uçları (Faz 06).
 *
 * İzinler (docs/06 "Puantaj düzenleme" satırı):
 * - attendance.view: liste/detay (kişisel veri minimum gerekli ilkesiyle).
 * - attendance.edit: oluşturma/güncelleme/pasife alma.
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  personnelCreateRequestSchema,
  personnelListQuerySchema,
  personnelUpdateRequestSchema,
  type PersonnelCreateRequest,
  type PersonnelListQuery,
  type PersonnelUpdateRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { PersonnelService } from './personnel.service.js';

@ApiTags('personnel')
@Controller('personnel')
export class PersonnelController {
  constructor(private readonly personnelService: PersonnelService) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  @Get()
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Personel listesi: arama (ad/sicil), durum filtresi, sayfalama' })
  list(@Query(new ZodValidationPipe(personnelListQuerySchema)) query: PersonnelListQuery) {
    return this.personnelService.list(query);
  }

  @Get(':id')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Personel detayı' })
  detail(@Param('id') id: string) {
    return this.personnelService.detail(id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('attendance.edit')
  @ApiOperation({ summary: 'Personel oluşturur; sicil numarası çakışması 409 döner' })
  async create(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(personnelCreateRequestSchema)) body: PersonnelCreateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.personnelService.create(userId ?? '', body, this.meta(req, client));
  }

  @Patch(':id')
  @RequirePermissions('attendance.edit')
  @ApiOperation({ summary: 'Personel günceller; status: PASSIVE ile pasife alma (geçmiş korunur)' })
  async update(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(personnelUpdateRequestSchema)) body: PersonnelUpdateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.personnelService.update(userId ?? '', id, body, this.meta(req, client));
  }
}
