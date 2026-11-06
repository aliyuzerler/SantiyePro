/**
 * Depo, malzeme ve stok hareketleri modülü (Faz 07).
 * Append-only hareket kaydı; bakiye koşullu atomik UPDATE ile güncellenir.
 */
import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

@Module({
  controllers: [InventoryController, StockController],
  providers: [InventoryService, StockService],
  // StockService de dışa açılır: Faz 09 /sync/push stok hareketi dispatch'i için.
  exports: [InventoryService, StockService],
})
export class InventoryModule {}
