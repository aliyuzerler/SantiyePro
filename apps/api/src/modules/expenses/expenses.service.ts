/**
 * Gider servisi (Faz 08).
 *
 * Kurallar (prompts/phase-08-development.md, docs/04, docs/06, docs/07):
 * - Kapsam: FIRM_ADMIN tümü; diğer roller üye oldukları projelerin
 *   giderlerini görür. Kapsam dışı kayıt 404 döner (IDOR koruması).
 * - Durum makinesi: DRAFT → (submit) PENDING → APPROVED | REJECTED.
 *   Düzenleme/silme yalnızca DRAFT'ta; onaylı/red edilmiş değişmez.
 * - Vergi oranı opsiyoneldir: verilmezse taxAmount null döner — hiçbir
 *   varsayılan oran uydurulmaz (uydurma yasal hesap yasak).
 * - Fiş/fatura eki Faz 05 özel medya deposundandır; varlığı doğrulanır.
 * - Tüm geçişler audit log'a yazılır; tutarlar DECIMAL(18,2) kanonik string.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  expenseTaxAmount,
  formatMoney,
  parseMoney,
  type ExpenseCategoryCreateRequest,
  type ExpenseCategoryDto,
  type ExpenseCategoryListQuery,
  type ExpenseCategoryUpdateRequest,
  type ExpenseCreateRequest,
  type ExpenseDto,
  type ExpenseListQuery,
  type ExpenseStatus,
  type ExpenseUpdateRequest,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';

interface Actor {
  userId: string;
  roles: string[];
}

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>;
type CategoryRow = Prisma.ExpenseCategoryGetPayload<Record<string, never>>;

const EXPENSE_INCLUDE = {
  project: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  receiptMedia: { select: { id: true } },
  approvedBy: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ExpenseInclude;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Ortak yardımcılar ----------

  async getActor(userId: string): Promise<Actor> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { roles: { select: { role: { select: { key: true } } } } },
    });
    return { userId, roles: user?.roles.map((r) => r.role.key) ?? [] };
  }

  private isAdmin(actor: Actor): boolean {
    return actor.roles.includes('FIRM_ADMIN');
  }

  async scopedProjectIds(actor: Actor): Promise<string[] | null> {
    if (this.isAdmin(actor)) return null;
    const rows = await this.prisma.projectMember.findMany({
      where: { userId: actor.userId },
      select: { projectId: true },
    });
    return rows.map((r) => r.projectId);
  }

  /** Gideri kapsam içinde getir; kapsam dışıysa 404 (IDOR). */
  async getExpenseInScope(actor: Actor, expenseId: string): Promise<ExpenseRow> {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, deletedAt: null },
      include: EXPENSE_INCLUDE,
    });
    if (!expense) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Gider bulunamadı' });
    if (!this.isAdmin(actor)) {
      const member = await this.prisma.projectMember.findFirst({
        where: { projectId: expense.projectId, userId: actor.userId },
        select: { id: true },
      });
      if (!member) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Gider bulunamadı' });
    }
    return expense;
  }

  // ---------- Kategoriler ----------

  async listCategories(userId: string, query: ExpenseCategoryListQuery) {
    void userId;
    const where: Prisma.ExpenseCategoryWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const rows = await this.prisma.expenseCategory.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return { data: rows.map(ExpensesService.toCategoryDto) };
  }

  async createCategory(
    actorUserId: string,
    input: ExpenseCategoryCreateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ExpenseCategoryDto> {
    const actor = await this.getActor(actorUserId);
    const duplicate = await this.prisma.expenseCategory.findUnique({ where: { name: input.name } });
    if (duplicate) {
      throw new ConflictException({ code: 'CONFLICT', message: 'Bu adla bir kategori zaten var' });
    }
    const row = await this.prisma.expenseCategory.create({
      data: { name: input.name, createdById: actor.userId },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'expensecategory.created',
      entityType: 'ExpenseCategory',
      entityId: row.id,
      after: { name: row.name },
      ...meta,
    });
    return ExpensesService.toCategoryDto(row);
  }

  async updateCategory(
    actorUserId: string,
    categoryId: string,
    input: ExpenseCategoryUpdateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ExpenseCategoryDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!current) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Kategori bulunamadı' });
    if (input.name && input.name !== current.name) {
      const duplicate = await this.prisma.expenseCategory.findUnique({ where: { name: input.name } });
      if (duplicate) throw new ConflictException({ code: 'CONFLICT', message: 'Bu adla bir kategori zaten var' });
    }
    const row = await this.prisma.expenseCategory.update({
      where: { id: current.id },
      data: { name: input.name, isActive: input.isActive },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'expensecategory.updated',
      entityType: 'ExpenseCategory',
      entityId: row.id,
      before: { name: current.name, isActive: current.isActive },
      after: { name: row.name, isActive: row.isActive },
      ...meta,
    });
    return ExpensesService.toCategoryDto(row);
  }

  private static toCategoryDto(row: CategoryRow): ExpenseCategoryDto {
    return {
      id: row.id,
      name: row.name,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ---------- Giderler ----------

  async listExpenses(userId: string, query: ExpenseListQuery) {
    const actor = await this.getActor(userId);
    const scope = await this.scopedProjectIds(actor);

    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            expenseDate: {
              ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}),
              ...(query.dateTo ? { lte: new Date(`${query.dateTo}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { description: { contains: query.search, mode: 'insensitive' } },
              { vendorName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      // Kapsam: yalnızca üye olunan projeler (admin hariç)
      ...(scope ? { projectId: { in: scope } } : {}),
    };

    const orderBy: Prisma.ExpenseOrderByWithRelationInput =
      query.sort === 'createdAt'
        ? { createdAt: query.order }
        : query.sort === 'amount'
          ? { amount: query.order }
          : { expenseDate: query.order };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: EXPENSE_INCLUDE,
      }),
    ]);

    return {
      data: rows.map(ExpensesService.toDto),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getExpense(userId: string, expenseId: string): Promise<ExpenseDto> {
    const actor = await this.getActor(userId);
    const expense = await this.getExpenseInScope(actor, expenseId);
    return ExpensesService.toDto(expense);
  }

  async createExpense(
    actorUserId: string,
    input: ExpenseCreateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ExpenseDto> {
    const actor = await this.getActor(actorUserId);
    const scope = await this.scopedProjectIds(actor);
    if (scope && !scope.includes(input.projectId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });
    }
    const project = await this.prisma.project.findUnique({ where: { id: input.projectId }, select: { id: true } });
    if (!project) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Proje bulunamadı' });

    const category = await this.prisma.expenseCategory.findUnique({ where: { id: input.categoryId } });
    if (!category) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Kategori bulunamadı' });
    if (!category.isActive) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Pasife alınmış kategori yeni giderde kullanılamaz' });
    }

    await this.assertReceiptMedia(input.receiptMediaId ?? null);

    const row = await this.prisma.expense.create({
      data: {
        projectId: input.projectId,
        categoryId: input.categoryId,
        vendorName: input.vendorName ?? null,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        taxRate: input.taxRate ?? null,
        expenseDate: new Date(`${input.expenseDate}T00:00:00.000Z`),
        receiptMediaId: input.receiptMediaId ?? null,
        createdById: actor.userId,
      },
      include: EXPENSE_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'expense.created',
      entityType: 'Expense',
      entityId: row.id,
      after: { projectId: row.projectId, amount: input.amount, currency: row.currency, status: row.status },
      ...meta,
    });

    return ExpensesService.toDto(row);
  }

  async updateExpense(
    actorUserId: string,
    expenseId: string,
    input: ExpenseUpdateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ExpenseDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getExpenseInScope(actor, expenseId);
    if (current.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Yalnızca taslak gider düzenlenebilir' });
    }
    if (current.createdById !== actor.userId && !this.isAdmin(actor)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Yalnızca gideri oluşturan veya firma yöneticisi düzenleyebilir' });
    }

    if (input.categoryId !== undefined) {
      const category = await this.prisma.expenseCategory.findUnique({ where: { id: input.categoryId } });
      if (!category) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Kategori bulunamadı' });
      if (!category.isActive) {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Pasife alınmış kategori kullanılamaz' });
      }
    }
    if (input.receiptMediaId !== undefined && input.receiptMediaId !== null) {
      await this.assertReceiptMedia(input.receiptMediaId);
    }

    const row = await this.prisma.expense.update({
      where: { id: current.id },
      data: {
        categoryId: input.categoryId,
        vendorName: input.vendorName !== undefined ? input.vendorName : undefined,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        taxRate: input.taxRate !== undefined ? input.taxRate : undefined,
        expenseDate: input.expenseDate ? new Date(`${input.expenseDate}T00:00:00.000Z`) : undefined,
        receiptMediaId: input.receiptMediaId,
      },
      include: EXPENSE_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'expense.updated',
      entityType: 'Expense',
      entityId: row.id,
      before: { amount: current.amount.toFixed(2), status: current.status, categoryId: current.categoryId },
      after: { amount: row.amount.toFixed(2), status: row.status, categoryId: row.categoryId },
      ...meta,
    });

    return ExpensesService.toDto(row);
  }

  async deleteExpense(
    actorUserId: string,
    expenseId: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<{ id: string; deleted: true }> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getExpenseInScope(actor, expenseId);
    if (current.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Yalnızca taslak gider silinebilir' });
    }
    if (current.createdById !== actor.userId && !this.isAdmin(actor)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Yalnızca gideri oluşturan veya firma yöneticisi silebilir' });
    }

    await this.prisma.expense.update({
      where: { id: current.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'expense.deleted',
      entityType: 'Expense',
      entityId: current.id,
      before: { amount: current.amount.toFixed(2), status: current.status },
      ...meta,
    });

    return { id: current.id, deleted: true };
  }

  async submitExpense(
    actorUserId: string,
    expenseId: string,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ExpenseDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getExpenseInScope(actor, expenseId);
    if (current.status !== 'DRAFT') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Yalnızca taslak gider onaya gönderilebilir' });
    }
    if (current.createdById !== actor.userId && !this.isAdmin(actor)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Yalnızca gideri oluşturan veya firma yöneticisi gönderebilir' });
    }

    const row = await this.prisma.expense.update({
      where: { id: current.id },
      data: { status: 'PENDING', submittedAt: new Date() },
      include: EXPENSE_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'expense.submitted',
      entityType: 'Expense',
      entityId: row.id,
      before: { status: current.status },
      after: { status: row.status },
      ...meta,
    });

    return ExpensesService.toDto(row);
  }

  async decideExpense(
    actorUserId: string,
    expenseId: string,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | undefined,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<ExpenseDto> {
    const actor = await this.getActor(actorUserId);
    const current = await this.getExpenseInScope(actor, expenseId);
    if (current.status !== 'PENDING') {
      throw new ConflictException({ code: 'CONFLICT', message: 'Yalnızca onay bekleyen gider karara bağlanabilir' });
    }
    if (decision === 'REJECTED' && !reason) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Red gerekçesi zorunludur' });
    }

    const row = await this.prisma.expense.update({
      where: { id: current.id },
      data: {
        status: decision,
        approvedById: actor.userId,
        approvedAt: new Date(),
        rejectionReason: decision === 'REJECTED' ? (reason ?? null) : null,
      },
      include: EXPENSE_INCLUDE,
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: decision === 'APPROVED' ? 'expense.approved' : 'expense.rejected',
      entityType: 'Expense',
      entityId: row.id,
      before: { status: current.status },
      after: { status: row.status, amount: row.amount.toFixed(2), ...(reason ? { reason } : {}) },
      ...meta,
    });

    return ExpensesService.toDto(row);
  }

  // ---------- Yardımcılar ----------

  private async assertReceiptMedia(receiptMediaId: string | null): Promise<void> {
    if (!receiptMediaId) return;
    const media = await this.prisma.mediaFile.findUnique({
      where: { id: receiptMediaId },
      select: { id: true, scanStatus: true },
    });
    if (!media) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Fiş/fatura eki bulunamadı' });
    if (media.scanStatus !== 'CLEAN') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Virüs taraması tamamlanmamış veya reddedilmiş dosya ek olarak kullanılamaz' });
    }
  }

  private static toDto(row: ExpenseRow): ExpenseDto {
    const taxRateStr = row.taxRate === null ? null : row.taxRate.toFixed(2);
    const amountStr = row.amount.toFixed(2);
    const taxAmount = taxRateStr === null ? null : expenseTaxAmount(amountStr, taxRateStr);
    return {
      id: row.id,
      projectId: row.projectId,
      projectName: row.project.name,
      categoryId: row.categoryId,
      categoryName: row.category.name,
      vendorName: row.vendorName,
      description: row.description,
      amount: amountStr,
      currency: row.currency,
      taxRate: taxRateStr,
      taxAmount,
      totalWithTax: taxAmount === null ? null : formatMoney(parseMoney(amountStr) + parseMoney(taxAmount)),
      expenseDate: row.expenseDate.toISOString().slice(0, 10),
      status: row.status as ExpenseStatus,
      receiptMediaId: row.receiptMedia?.id ?? null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      approvedById: row.approvedById,
      approvedBy: row.approvedBy ? { id: row.approvedBy.id, fullName: row.approvedBy.fullName } : null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      createdById: row.createdById,
      createdBy: { id: row.createdBy.id, fullName: row.createdBy.fullName },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
