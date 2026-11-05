/**
 * Depo, malzeme ve bakiye uçları (Faz 07).
 *
 * İzinler (docs/06 "Stok hareketi" ve "Rapor/dışa aktarma" satırları):
 * - inventory.view: liste/görüntüleme (FIRM_ADMIN, PROJECT_MANAGER, SITE_CHIEF,
 *   TECH_OFFICE, WAREHOUSE, ACCOUNTING).
 * - inventory.move: depo/malzeme yönetimi (FIRM_ADMIN, PROJECT_MANAGER, WAREHOUSE).
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  balanceListQuerySchema,
  materialCreateRequestSchema,
  materialListQuerySchema,
  materialUpdateRequestSchema,
  warehouseCreateRequestSchema,
  warehouseListQuerySchema,
  warehouseUpdateRequestSchema,
  type BalanceListQuery,
  type MaterialCreateRequest,
  type MaterialListQuery,
  type MaterialUpdateRequest,
  type WarehouseCreateRequest,
  type WarehouseListQuery,
  type WarehouseUpdateRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  // ---------- Depolar ----------

  @Get('warehouses')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'Depo listesi: kurum deposu + üye olunan proje depoları (kapsamlı)' })
  listWarehouses(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(warehouseListQuerySchema)) query: WarehouseListQuery,
  ) {
    return this.inventoryService.listWarehouses(userId ?? '', query);
  }

  @Post('warehouses')
  @HttpCode(201)
  @RequirePermissions('inventory.move')
  @ApiOperation({ summary: 'Depo açma: projectId verilmezse kurum merkezi deposu' })
  createWarehouse(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(warehouseCreateRequestSchema)) body: WarehouseCreateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.inventoryService.createWarehouse(userId ?? '', body, this.meta(req, client));
  }

  @Patch('warehouses/:id')
  @RequirePermissions('inventory.move')
  @ApiOperation({ summary: 'Depo güncelleme (ad, konum, aktiflik); kapsam dışıysa 404' })
  updateWarehouse(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(warehouseUpdateRequestSchema)) body: WarehouseUpdateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.inventoryService.updateWarehouse(userId ?? '', id, body, this.meta(req, client));
  }

  // ---------- Malzemeler ----------

  @Get('materials')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'Malzeme katalog listesi (kurum geneli): arama, aktiflik, sayfalama' })
  listMaterials(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(materialListQuerySchema)) query: MaterialListQuery,
  ) {
    return this.inventoryService.listMaterials(userId ?? '', query);
  }

  @Post('materials')
  @HttpCode(201)
  @RequirePermissions('inventory.move')
  @ApiOperation({ summary: 'Malzeme oluşturma: kod benzersiz (409), birim ve min. stok tanımlı' })
  createMaterial(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(materialCreateRequestSchema)) body: MaterialCreateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.inventoryService.createMaterial(userId ?? '', body, this.meta(req, client));
  }

  @Patch('materials/:id')
  @RequirePermissions('inventory.move')
  @ApiOperation({ summary: 'Malzeme güncelleme; pasife alma yeni hareketi engeller' })
  updateMaterial(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(materialUpdateRequestSchema)) body: MaterialUpdateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.inventoryService.updateMaterial(userId ?? '', id, body, this.meta(req, client));
  }

  // ---------- Bakiye (stok kartları) ----------

  @Get('balances')
  @RequirePermissions('inventory.view')
  @ApiOperation({
    summary: 'Stok kartları: malzeme × depo bakiyesi + son güncelleme zamanı + kritik stok bayrağı',
  })
  listBalances(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(balanceListQuerySchema)) query: BalanceListQuery,
  ) {
    return this.inventoryService.listBalances(userId ?? '', query);
  }
}
