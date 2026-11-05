import { Module } from '@nestjs/common';
import { OrgSettingsController } from './org-settings.controller.js';
import { OrgSettingsService } from './org-settings.service.js';

/**
 * Kurum ayarları modülü (Faz 06) — devam durumlarının kurum tanımlı uzantısı.
 */
@Module({
  controllers: [OrgSettingsController],
  providers: [OrgSettingsService],
  exports: [OrgSettingsService],
})
export class OrgSettingsModule {}
