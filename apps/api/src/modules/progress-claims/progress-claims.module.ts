/**
 * Hakediş modülü (Faz 08).
 */
import { Module } from '@nestjs/common';
import { ProgressClaimsController } from './progress-claims.controller.js';
import { ProgressClaimsService } from './progress-claims.service.js';
import { ContractItemsService } from './contract-items.service.js';

@Module({
  controllers: [ProgressClaimsController],
  providers: [ProgressClaimsService, ContractItemsService],
  exports: [ProgressClaimsService],
})
export class ProgressClaimsModule {}
