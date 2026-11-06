import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/** Denetim günlüğü okuma modülü (Faz 10) — yazım AuditService (common) üzerinden yapılır. */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
