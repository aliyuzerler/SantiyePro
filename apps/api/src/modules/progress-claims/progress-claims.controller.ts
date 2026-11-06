/**
 * Hakediş ve sözleşme kalemi uçları (Faz 08) — docs/05 "Hakediş" satırı.
 *
 * İzinler (docs/06 satırları):
 * - claim.prepare: hazırlama + görüntüleme (FIRM_ADMIN, PROJECT_MANAGER,
 *   TECH_OFFICE, ACCOUNTING).
 * - claim.approve: onay/red (FIRM_ADMIN, ACCOUNTING).
 * - PDF/Excel çıktı altyapısı Faz 10 rapor fazında tamamlanır (report.export).
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  claimCancelRequestSchema,
  contractItemCreateRequestSchema,
  contractItemListQuerySchema,
  contractItemUpdateRequestSchema,
  expenseDecisionRequestSchema,
  progressClaimCreateRequestSchema,
  progressClaimLineReplaceSchema,
  progressClaimListQuerySchema,
  progressClaimUpdateRequestSchema,
  type ClaimCancelRequest,
  type ContractItemCreateRequest,
  type ContractItemListQuery,
  type ContractItemUpdateRequest,
  type ExpenseDecisionRequest,
  type ProgressClaimCreateRequest,
  type ProgressClaimLineReplace,
  type ProgressClaimListQuery,
  type ProgressClaimUpdateRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { ProgressClaimsService } from './progress-claims.service.js';
import { ContractItemsService } from './contract-items.service.js';

@ApiTags('progress-claims')
@Controller('progress-claims')
export class ProgressClaimsController {
  constructor(
    private readonly claimsService: ProgressClaimsService,
    private readonly contractItemsService: ContractItemsService,
  ) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  // ---------- Sözleşme kalemleri ----------

  @Get('contract-items')
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Sözleşme kalemleri (proje kapsamlı): birim, sözleşme miktarı, birim fiyatı' })
  listContractItems(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(contractItemListQuerySchema)) query: ContractItemListQuery,
  ) {
    return this.contractItemsService.listContractItems(userId ?? '', query);
  }

  @Post('contract-items')
  @HttpCode(201)
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Sözleşme kalemi oluşturma; kod proje içinde benzersiz' })
  createContractItem(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(contractItemCreateRequestSchema)) body: ContractItemCreateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.contractItemsService.createContractItem(userId ?? '', body, this.meta(req, client));
  }

  @Patch('contract-items/:id')
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Kalem güncelleme; fiyat değişimi yalnızca yeni hakedişleri etkiler (snapshot)' })
  updateContractItem(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(contractItemUpdateRequestSchema)) body: ContractItemUpdateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.contractItemsService.updateContractItem(userId ?? '', id, body, this.meta(req, client));
  }

  // ---------- Hakedişler ----------

  @Get()
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Hakediş listesi (proje zorunlu); kapsamlı' })
  listClaims(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(progressClaimListQuerySchema)) query: ProgressClaimListQuery,
  ) {
    return this.claimsService.listClaims(userId ?? '', query);
  }

  @Get(':id')
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Hakediş detayı: satırlar (snapshot fiyatlı) + toplamlar + formül açıklaması' })
  getClaim(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.claimsService.getClaim(userId ?? '', id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Hakediş oluşturma (DRAFT): claimNo benzersiz, dönem çakışmasız, zincir doğrulanır' })
  createClaim(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(progressClaimCreateRequestSchema)) body: ProgressClaimCreateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.claimsService.createClaim(userId ?? '', body, this.meta(req, client));
  }

  @Patch(':id')
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Taslak hakediş düzenleme (dönem, not, kesinti); onaylıda 409' })
  updateClaim(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(progressClaimUpdateRequestSchema)) body: ProgressClaimUpdateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.claimsService.updateClaim(userId ?? '', id, body, this.meta(req, client));
  }

  @Put(':id/lines')
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Taslak satırlarını değiştir; snapshot ve zincir yeniden doğrulanır' })
  replaceLines(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(progressClaimLineReplaceSchema)) body: ProgressClaimLineReplace,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.claimsService.replaceLines(userId ?? '', id, body, this.meta(req, client));
  }

  @Delete(':id')
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Taslak hakediş silme (soft delete); onaylı silinemez (409)' })
  deleteClaim(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.claimsService.deleteClaim(userId ?? '', id, this.meta(req, client));
  }

  @Post(':id/calculate')
  @HttpCode(200)
  @RequirePermissions('claim.prepare')
  @ApiOperation({
    summary: 'Hesaplama önizlemesi: DRAFT yeniden hesaplar; onaylı saklanan değeri döner (geçmiş değişmez)',
  })
  calculateClaim(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.claimsService.calculateClaim(userId ?? '', id);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'Taslak → Onay bekliyor; zincir/çakışma kuralları yeniden doğrulanır' })
  submitClaim(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.claimsService.submitClaim(userId ?? '', id, this.meta(req, client));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('claim.approve')
  @ApiOperation({ summary: 'Onay bekliyor → Onaylandı; değerler dondurulur (claim.approve)' })
  approveClaim(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.claimsService.decideClaim(userId ?? '', id, 'APPROVED', undefined, this.meta(req, client));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('claim.approve')
  @ApiOperation({ summary: 'Onay bekliyor → Reddedildi (gerekçe zorunlu)' })
  rejectClaim(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(expenseDecisionRequestSchema)) body: ExpenseDecisionRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.claimsService.decideClaim(userId ?? '', id, 'REJECTED', body.reason, this.meta(req, client));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('claim.prepare')
  @ApiOperation({ summary: 'İptal (yalnızca DRAFT/PENDING; onaylıda 409 — mahsup hakedişi kuralı)' })
  cancelClaim(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(claimCancelRequestSchema)) body: ClaimCancelRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.claimsService.cancelClaim(userId ?? '', id, body.reason, this.meta(req, client));
  }
}
