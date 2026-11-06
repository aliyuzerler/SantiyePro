/**
 * Senkronizasyon modülü (Faz 09) — mobil offline-first akışının sunucu ucu.
 * Dispatch gerçek servisler üzerinden yapıldığı için ilgili modüller içeri alınır.
 */
import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { TasksModule } from '../tasks/tasks.module.js';
import { DailyReportsModule } from '../daily-reports/daily-reports.module.js';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';

@Module({
  imports: [AttendanceModule, TasksModule, DailyReportsModule, ExpensesModule, InventoryModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
