/**
 * Puantaj uçları (Faz 06).
 *
 * İzinler (docs/06 "Puantaj düzenleme" satırı):
 * - attendance.view: liste/özet (Teknik Ofis ve Muhasebe görüntüleyebilir).
 * - attendance.edit: işaretleme/düzenleme/toplu işaretleme.
 *
 * Toplu işaretleme akışı: POST /attendance/bulk/preview (yazma yok) →
 * POST /attendance/bulk (confirm: true zorunlu — zod şeması reddeder).
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  attendanceListQuerySchema,
  attendanceSummaryQuerySchema,
  availableAttendanceStatuses,
  bulkAttendanceConfirmRequestSchema,
  bulkAttendancePreviewRequestSchema,
  createAttendanceRequestSchema,
  customAttendanceStatusLabels,
  DEFAULT_ATTENDANCE_STATUS_LABELS,
  updateAttendanceRequestSchema,
  type AttendanceListQuery,
  type AttendanceSummaryQuery,
  type BulkAttendanceConfirmRequest,
  type BulkAttendancePreviewRequest,
  type CreateAttendanceRequest,
  type UpdateAttendanceRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { AttendanceService } from './attendance.service.js';
import { OrgSettingsService } from '../org/org-settings.service.js';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly orgSettingsService: OrgSettingsService,
  ) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  @Get('statuses')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Geçerli devam durumları: 6 varsayılan + kurum tanımlı uzantılar' })
  async statuses() {
    const settings = await this.orgSettingsService.get();
    const custom = settings.attendanceCustomStatuses;
    return {
      statuses: availableAttendanceStatuses(custom),
      labels: { ...DEFAULT_ATTENDANCE_STATUS_LABELS, ...customAttendanceStatusLabels(custom) },
    };
  }

  @Get('summary')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Proje/tarih aralığı özeti: durum adetleri, kişi sayısı, çalışılan dakika' })
  async summary(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(attendanceSummaryQuerySchema)) query: AttendanceSummaryQuery,
  ) {
    return this.attendanceService.summary(userId ?? '', query);
  }

  @Get()
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Puantaj listesi: proje+gün (puantaj tablosu) veya personel bazlı' })
  list(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(attendanceListQuerySchema)) query: AttendanceListQuery,
  ) {
    return this.attendanceService.list(userId ?? '', query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('attendance.edit')
  @ApiOperation({
    summary: 'Tek satır işaretleme; duplicate 409 döner, clientMutationId ile idempotenttir (çevrimdışı kuyruk)',
  })
  async create(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(createAttendanceRequestSchema)) body: CreateAttendanceRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.attendanceService.create(userId ?? '', body, this.meta(req, client));
  }

  @Patch(':id')
  @RequirePermissions('attendance.edit')
  @ApiOperation({ summary: 'Puantaj kaydı düzeltme (durum, giriş-çıkış, not); kapsam dışıysa 404' })
  async update(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAttendanceRequestSchema)) body: UpdateAttendanceRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.attendanceService.update(userId ?? '', id, body, this.meta(req, client));
  }

  @Post('bulk/preview')
  @HttpCode(200)
  @RequirePermissions('attendance.edit')
  @ApiOperation({ summary: 'Toplu işaretleme önizlemesi: satır satır CREATE/UPDATE/SKIP planı; yazma yok' })
  async bulkPreview(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(bulkAttendancePreviewRequestSchema)) body: BulkAttendancePreviewRequest,
  ) {
    return this.attendanceService.bulkPreview(userId ?? '', body);
  }

  @Post('bulk')
  @HttpCode(200)
  @RequirePermissions('attendance.edit')
  @ApiOperation({ summary: 'Toplu işaretleme onayı: confirm: true zorunlu; SKIP satırlarına dokunulmaz' })
  async bulkConfirm(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(bulkAttendanceConfirmRequestSchema)) body: BulkAttendanceConfirmRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.attendanceService.bulkConfirm(userId ?? '', body, this.meta(req, client));
  }
}
