import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { OrgSettingsModule } from '../org/org-settings.module.js';

/**
 * Puantaj modülü (Faz 06) — günlük devam işaretleme, toplu işaretleme
 * (önizleme + onay) ve özet uçları. Kurum ayarlarına bağlıdır (özel durumlar).
 */
@Module({
  imports: [OrgSettingsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
