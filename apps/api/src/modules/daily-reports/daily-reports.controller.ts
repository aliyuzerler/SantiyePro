import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createDailyReportRequestSchema,
  dailyReportListQuerySchema,
  rejectDailyReportRequestSchema,
  updateDailyReportRequestSchema,
  type CreateDailyReportRequest,
  type DailyReportListQuery,
  type RejectDailyReportRequest,
  type UpdateDailyReportRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { DailyReportsService } from './daily-reports.service.js';

/**
 * Günlük şantiye raporu uçları (Faz 05).
 * İzinler (docs/06): görüntüleme dailyreport.view, oluşturma/düzenleme/gönderim
 * dailyreport.create, onay/red dailyreport.approve; kapsam servis katmanında.
 */
@ApiTags('daily-reports')
@Controller('daily-reports')
export class DailyReportsController {
  constructor(private readonly dailyReportsService: DailyReportsService) {}

  @Get()
  @RequirePermissions('dailyreport.view')
  @ApiOperation({ summary: 'Rapor listesi: proje/durum/tarih aralığı filtreleri + sayfalama' })
  async list(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(dailyReportListQuerySchema)) query: DailyReportListQuery,
  ) {
    return this.dailyReportsService.list(userId ?? '', query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('dailyreport.create')
  @ApiOperation({ summary: 'Taslak rapor oluşturur (workers + medya ekleriyle)' })
  async create(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(createDailyReportRequestSchema)) body: CreateDailyReportRequest,
  ) {
    return this.dailyReportsService.create(userId ?? '', body, { ip: '', userAgent: '', traceId: undefined });
  }

  @Get(':id')
  @RequirePermissions('dailyreport.view')
  @ApiOperation({ summary: 'Rapor detayı: ekip, medya galerisi (imzalı URL) ve revizyon geçmişi' })
  async detail(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.dailyReportsService.detail(userId ?? '', id);
  }

  @Patch(':id')
  @RequirePermissions('dailyreport.create')
  @ApiOperation({
    summary:
      'Rapor güncelleme — SUBMITTED/APPROVED ise önceki içerik snapshot’lanır (revizyon), DRAFT/REJECTED serbest',
  })
  async update(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDailyReportRequestSchema)) body: UpdateDailyReportRequest,
  ) {
    return this.dailyReportsService.update(userId ?? '', id, body, { ip: '', userAgent: '', traceId: undefined });
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('dailyreport.create')
  @ApiOperation({ summary: 'Raporu gönderime alır (DRAFT/REJECTED → SUBMITTED)' })
  async submit(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.dailyReportsService.submit(userId ?? '', id, { ip: '', userAgent: '', traceId: undefined });
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions('dailyreport.create')
  @ApiOperation({ summary: 'Reddedilen raporu taslağa geri alır (REJECTED → DRAFT)' })
  async reopen(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.dailyReportsService.reopen(userId ?? '', id, { ip: '', userAgent: '', traceId: undefined });
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('dailyreport.approve')
  @ApiOperation({ summary: 'Raporu onaylar (SUBMITTED → APPROVED)' })
  async approve(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.dailyReportsService.approve(userId ?? '', id, { ip: '', userAgent: '', traceId: undefined });
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('dailyreport.approve')
  @ApiOperation({ summary: 'Raporu gerekçesiyle reddeder (SUBMITTED → REJECTED)' })
  async reject(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectDailyReportRequestSchema)) body: RejectDailyReportRequest,
  ) {
    return this.dailyReportsService.reject(userId ?? '', id, body.reason, {
      ip: '',
      userAgent: '',
      traceId: undefined,
    });
  }
}
