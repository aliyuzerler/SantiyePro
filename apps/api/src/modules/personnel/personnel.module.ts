import { Module } from '@nestjs/common';
import { PersonnelController } from './personnel.controller.js';
import { PersonnelService } from './personnel.service.js';

/**
 * Personel modülü (Faz 06) — kurum genelindeki işçi/taşeron kayıtları.
 */
@Module({
  controllers: [PersonnelController],
  providers: [PersonnelService],
  exports: [PersonnelService],
})
export class PersonnelModule {}
