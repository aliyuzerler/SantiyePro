/**
 * Rapor uçları (Faz 10).
 *
 * Yetki modeli (docs/06, contracts/reports.ts REPORT_PERMISSIONS):
 * - Her rapor kendi alt veri izniyle açılır (project.view, attendance.view,
 *   inventory.view, expense.create, claim.prepare, task.view, dailyreport.view).
 * - Export ayrıca report.export ister (FIRM_ADMIN, PROJECT_MANAGER, SITE_CHIEF,
 *   TECH_OFFICE, ACCOUNTING — rbac matrisi) ve AUDIT LOG üretir.
 * - Kapsam servis katmanında uygulanır (ReportsService.scopedProjectIds).
 * - /reports/:key/export tek handler'dır; izin anahtara göre dinamik denetlenir
 *   (PermissionsGuard.assertPermission) — deny-by-default korunur.
 */
import { Controller, Get, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  attendanceReportQuerySchema,
  claimSummaryQuerySchema,
  dailyReportSummaryQuerySchema,
  expenseSummaryQuerySchema,
  projectOverviewQuerySchema,
  reportExportQuerySchema,
  reportKeySchema,
  stockBalanceQuerySchema,
  stockMovementQuerySchema,
  taskStatusQuerySchema,
  REPORT_PERMISSIONS,
  type AttendanceReportQuery,
  type ClaimSummaryQuery,
  type DailyReportSummaryQuery,
  type ExpenseSummaryQuery,
  type ProjectOverviewQuery,
  type ReportExportQuery,
  type StockBalanceQuery,
  type StockMovementQuery,
  type TaskStatusQuery,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { PermissionsGuard } from '../../common/auth/permissions.guard.js';
import { ReportsService } from './reports.service.js';
import { ReportExportService } from './export.service.js';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly exportService: ReportExportService,
    private readonly permissionsGuard: PermissionsGuard,
  ) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  @Get('project-overview')
  @RequirePermissions('project.view')
  @ApiOperation({ summary: 'Proje genel görünümü: görev/rapor/puantaj/stok/gider/hakediş özeti' })
  projectOverview(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(projectOverviewQuerySchema)) query: ProjectOverviewQuery,
  ) {
    return this.reportsService.projectOverview(userId ?? '', query);
  }

  @Get('daily-reports')
  @RequirePermissions('dailyreport.view')
  @ApiOperation({ summary: 'Günlük rapor özeti: tarih × proje durum sayıları' })
  dailyReportSummary(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(dailyReportSummaryQuerySchema)) query: DailyReportSummaryQuery,
  ) {
    return this.reportsService.dailyReportSummary(userId ?? '', query);
  }

  @Get('attendance')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Puantaj özeti: tarih × proje kayıt ve durum dağılımı' })
  attendanceReport(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(attendanceReportQuerySchema)) query: AttendanceReportQuery,
  ) {
    return this.reportsService.attendanceReport(userId ?? '', query);
  }

  @Get('stock/balance')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'Stok bakiyesi: malzeme × depo kartları, kritik stok işareti' })
  stockBalance(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(stockBalanceQuerySchema)) query: StockBalanceQuery,
  ) {
    return this.reportsService.stockBalance(userId ?? '', query);
  }

  @Get('stock/movements')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'Stok hareketleri: append-only hareket listesi (tarih aralıklı)' })
  stockMovements(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(stockMovementQuerySchema)) query: StockMovementQuery,
  ) {
    return this.reportsService.stockMovements(userId ?? '', query);
  }

  @Get('expenses')
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Gider özeti: kategori × durum toplamları (para birimi ayrı)' })
  expenseSummary(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(expenseSummaryQuerySchema)) query: ExpenseSummaryQuery,
  ) {
    return this.reportsService.expenseSummary(userId ?? '', query);
  }

  @Get('claims')
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Hakediş dönem özeti: dönem, durum, brüt/kesinti/net/kümülatif' })
  claimSummary(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(claimSummaryQuerySchema)) query: ClaimSummaryQuery,
  ) {
    return this.reportsService.claimSummary(userId ?? '', query);
  }

  @Get('tasks')
  @RequirePermissions('task.view')
  @ApiOperation({ summary: 'Görev durum/termin raporu: proje başına durum ve gecikme sayıları' })
  taskStatus(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(taskStatusQuerySchema)) query: TaskStatusQuery,
  ) {
    return this.reportsService.taskStatus(userId ?? '', query);
  }

  /**
   * Dışa aktarma — PDF (Türkçe karakterli gömülü font) veya XLSX (gerçek hücre
   * tipleri). İzin anahtara göre dinamik denetlenir; her çağrı audit log üretir.
   * Bu handler parametreli olduğu için en son bildirilir (NestJS yol eşleşmesi).
   */
  @Get(':key/export')
  @ApiOperation({ summary: 'Raporu PDF/XLSX olarak indirir; report.export izni + audit log' })
  async export(
    @CurrentUser('userId') userId: string | undefined,
    @Param('key') key: string,
    @Query(new ZodValidationPipe(reportExportQuerySchema)) query: ReportExportQuery,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
    @Res() res: Response,
  ) {
    const parsed = reportKeySchema.safeParse(key);
    if (!parsed.success) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Rapor bulunamadı' });
    const reportKey = parsed.data;

    await this.permissionsGuard.assertPermission(userId ?? '', REPORT_PERMISSIONS[reportKey]);
    const result = await this.exportService.exportReport(userId ?? '', reportKey, query.format, query, this.meta(req, client));

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Row-Count', String(result.rowCount));
    res.setHeader('X-Audit-Log-Id', result.auditLogId ?? '');
    res.send(result.buffer);
  }
}
