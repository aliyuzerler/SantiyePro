import { Module } from '@nestjs/common';
import { DailyReportsController } from './daily-reports.controller.js';
import { DailyReportsService } from './daily-reports.service.js';
import { MediaModule } from '../media/media.module.js';

/** Günlük şantiye raporu modülü (Faz 05). */
@Module({
  imports: [MediaModule],
  controllers: [DailyReportsController],
  providers: [DailyReportsService],
  exports: [DailyReportsService],
})
export class DailyReportsModule {}
