import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportExportService } from './export.service.js';
import { ReportsService } from './reports.service.js';

/**
 * Raporlama ve dışa aktarma (Faz 10).
 * AuditService + PermissionsGuard CommonModule'dan (global) gelir.
 */
@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportExportService],
})
export class ReportsModule {}
