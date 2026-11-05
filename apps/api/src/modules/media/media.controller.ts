import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  completeMediaUploadSchema,
  requestMediaUploadUrlSchema,
  type CompleteMediaUpload,
  type RequestMediaUploadUrl,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, Public, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { MediaService } from './media.service.js';

/**
 * Medya uçları (Faz 05).
 *
 * Güvenlik modeli:
 * - upload-url / complete / download-url: kimlik doğrulamalı + izinli.
 * - PUT /:id/content ve GET /:id/content: @Public — erişim yalnızca kısa ömürlü
 *   HMAC imzasıyla denetlenir (<img>/binary PUT başlık taşıyamaz).
 * - storageKey hiçbir yanıtta yer almaz; loglarda dosya yolu bulunmaz (docs/07).
 */
@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as Request & { traceId?: string }).traceId };
  }

  @Post('upload-url')
  @HttpCode(201)
  @RequirePermissions('dailyreport.create')
  @ApiOperation({ summary: 'Yükleme başlatır: allowlist/boyut denetimi + imzalı PUT URL (docs/05)' })
  async requestUploadUrl(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(requestMediaUploadUrlSchema)) body: RequestMediaUploadUrl,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.mediaService.requestUploadUrl(userId ?? '', body, this.meta(req, client));
  }

  @Public()
  @Put(':id/content')
  @HttpCode(200)
  @ApiOperation({ summary: 'İmzalı yükleme ucu — ikili gövde; magic-byte + boyut + EXIF soyulması' })
  async uploadContent(
    @Param('id') id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Req() req: Request,
  ) {
    await this.mediaService.saveContent(id, exp, sig, req);
    return { status: 'ok' };
  }

  @Post('complete')
  @HttpCode(200)
  @RequirePermissions('dailyreport.create')
  @ApiOperation({ summary: 'Yüklemeyi doğrular ve imzalı indirme URL’i döner' })
  async complete(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(completeMediaUploadSchema)) body: CompleteMediaUpload,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.mediaService.complete(userId ?? '', body.mediaId, this.meta(req, client));
  }

  @Get(':id/download-url')
  @RequirePermissions('dailyreport.view')
  @ApiOperation({ summary: 'Kapsam denetimli taze imzalı indirme URL’i' })
  async downloadUrl(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.mediaService.getDownloadUrl(userId ?? '', id);
  }

  @Public()
  @Get(':id/content')
  @ApiOperation({ summary: 'İmzalı içerik ucu — private depodan akıtılır; Cache-Control: private' })
  async content(
    @Param('id') id: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.mediaService.readContent(id, exp, sig);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(buffer);
  }
}
