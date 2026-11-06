/**
 * Denetim günlüğü uçları (Faz 10) — yalnızca audit.view (FIRM_ADMIN).
 * docs/06: "Audit log" satırı; ekran erişimi tamamen izne bağlıdır.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { auditLogQuerySchema, type AuditLogQuery } from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import { AuditService } from './audit.service.js';

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs')
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'Denetim günlüğü: entity/action/aktör/tarih filtreli, önce-sonra gövdeli' })
  list(@CurrentUser('userId') userId: string | undefined, @Query(new ZodValidationPipe(auditLogQuerySchema)) query: AuditLogQuery) {
    return this.auditService.list(userId ?? '', query);
  }

  @Get('facets')
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'Denetim günlüğü filtre değerleri (entityType/action ayrık liste)' })
  facets(@CurrentUser('userId') userId: string | undefined) {
    return this.auditService.facets(userId ?? '');
  }
}
