/**
 * Kurum ayarları uçları (Faz 06).
 * - GET: oturumlu her kullanıcı okuyabilir (UI durum listesi kurmak için).
 * - PATCH: yalnızca FIRM_SETTINGS_MANAGE (docs/06 "Firma ayarı" satırı).
 */
import { Body, Controller, Get, HttpCode, Patch, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  updateOrgSettingsRequestSchema,
  type UpdateOrgSettingsRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { OrgSettingsService } from './org-settings.service.js';

@ApiTags('org')
@Controller('org')
export class OrgSettingsController {
  constructor(private readonly orgSettingsService: OrgSettingsService) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  @Get('settings')
  @ApiOperation({ summary: 'Kurum ayarları: özel devam durumları listesi' })
  get() {
    return this.orgSettingsService.get();
  }

  @Patch('settings')
  @HttpCode(200)
  @RequirePermissions('firm.settings.manage')
  @ApiOperation({ summary: 'Özel devam durumlarını günceller (yalnızca firma yöneticisi)' })
  async update(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(updateOrgSettingsRequestSchema)) body: UpdateOrgSettingsRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.orgSettingsService.update(userId ?? '', body, this.meta(req, client));
  }
}
