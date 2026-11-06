/**
 * Gider uçları (Faz 08) — docs/05 "Expenses" satırı + kategori yönetimi.
 *
 * İzinler (docs/06 satırları):
 * - expense.create: gider oluşturma/düzenleme/gönderme + listeleme
 *   (FIRM_ADMIN, PROJECT_MANAGER, ACCOUNTING) — finans verisi okuma hakkı
 *   MVP'de oluşturma iznine bağlanmıştır ("sınırlı" hücreler Faz 10'a bırakıldı).
 * - expense.approve: onay/red (FIRM_ADMIN, ACCOUNTING).
 * - firm.settings.manage: kategori yönetimi (FIRM_ADMIN).
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestWithTrace } from '../../common/trace-id.middleware.js';
import {
  expenseCategoryCreateRequestSchema,
  expenseCategoryListQuerySchema,
  expenseCategoryUpdateRequestSchema,
  expenseCreateRequestSchema,
  expenseDecisionRequestSchema,
  expenseListQuerySchema,
  expenseUpdateRequestSchema,
  type ExpenseCategoryCreateRequest,
  type ExpenseCategoryListQuery,
  type ExpenseCategoryUpdateRequest,
  type ExpenseCreateRequest,
  type ExpenseDecisionRequest,
  type ExpenseListQuery,
  type ExpenseUpdateRequest,
} from '@santiyepro/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ClientInfo, CurrentUser, RequirePermissions, type ClientMeta } from '../../common/auth/decorators.js';
import { ExpensesService } from './expenses.service.js';

@ApiTags('expenses')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  private meta(req: Request, client: ClientMeta) {
    return { ip: client.ip, userAgent: client.userAgent, traceId: (req as RequestWithTrace).traceId };
  }

  // ---------- Kategoriler ----------

  @Get('categories')
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Gider kategorileri (kurum geneli): aktiflik filtresi' })
  listCategories(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(expenseCategoryListQuerySchema)) query: ExpenseCategoryListQuery,
  ) {
    return this.expensesService.listCategories(userId ?? '', query);
  }

  @Post('categories')
  @HttpCode(201)
  @RequirePermissions('firm.settings.manage')
  @ApiOperation({ summary: 'Kategori oluşturma (FIRM_ADMIN); ad benzersiz' })
  createCategory(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(expenseCategoryCreateRequestSchema)) body: ExpenseCategoryCreateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.expensesService.createCategory(userId ?? '', body, this.meta(req, client));
  }

  @Patch('categories/:id')
  @RequirePermissions('firm.settings.manage')
  @ApiOperation({ summary: 'Kategori güncelleme (ad/aktiflik)' })
  updateCategory(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(expenseCategoryUpdateRequestSchema)) body: ExpenseCategoryUpdateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.expensesService.updateCategory(userId ?? '', id, body, this.meta(req, client));
  }

  // ---------- Giderler ----------

  @Get()
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Gider listesi: en az bir filtre zorunlu; kapsamlı' })
  listExpenses(
    @CurrentUser('userId') userId: string | undefined,
    @Query(new ZodValidationPipe(expenseListQuerySchema)) query: ExpenseListQuery,
  ) {
    return this.expensesService.listExpenses(userId ?? '', query);
  }

  @Get(':id')
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Gider detayı; kapsam dışıysa 404' })
  getExpense(@CurrentUser('userId') userId: string | undefined, @Param('id') id: string) {
    return this.expensesService.getExpense(userId ?? '', id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Gider oluşturma (DRAFT): kategori, tutar, para birimi, opsiyonel vergi, fiş eki' })
  createExpense(
    @CurrentUser('userId') userId: string | undefined,
    @Body(new ZodValidationPipe(expenseCreateRequestSchema)) body: ExpenseCreateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.expensesService.createExpense(userId ?? '', body, this.meta(req, client));
  }

  @Patch(':id')
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Taslak gider düzenleme; onaylı/red edilmiş değiştirilemez (409)' })
  updateExpense(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(expenseUpdateRequestSchema)) body: ExpenseUpdateRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.expensesService.updateExpense(userId ?? '', id, body, this.meta(req, client));
  }

  @Delete(':id')
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Taslak gider silme (soft delete); onaylı silinemez (409)' })
  deleteExpense(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.expensesService.deleteExpense(userId ?? '', id, this.meta(req, client));
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Taslak → Onay bekliyor' })
  submitExpense(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.expensesService.submitExpense(userId ?? '', id, this.meta(req, client));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('expense.approve')
  @ApiOperation({ summary: 'Onay bekliyor → Onaylandı (expense.approve)' })
  approveExpense(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.expensesService.decideExpense(userId ?? '', id, 'APPROVED', undefined, this.meta(req, client));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('expense.approve')
  @ApiOperation({ summary: 'Onay bekliyor → Reddedildi (gerekçe zorunlu)' })
  rejectExpense(
    @CurrentUser('userId') userId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(expenseDecisionRequestSchema)) body: ExpenseDecisionRequest,
    @Req() req: Request,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.expensesService.decideExpense(userId ?? '', id, 'REJECTED', body.reason, this.meta(req, client));
  }
}
