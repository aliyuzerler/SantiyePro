/**
 * Personel servisi (Faz 06).
 *
 * Model (docs/04, prompts/phase-06-development.md):
 * - Personel kurum genelinde bir kaynaktır; proje kapsamı puantaj kaydında uygulanır.
 * - Sert silme yoktur: iş kayıtları append-only felsefesi gereği korunur,
 *   personel PASİFE alınır (test promptu: "Personel CRUD ve pasife alma").
 * - Sicil numarası verilmişse kurum içinde benzersizdir (DB unique + servis kontrolü).
 * - Tüm yazma işlemleri audit log üretir (docs/07); telefon gibi kişisel veriler
 *   yalnızca attendance.view izni taşıyan uçlarla görünür (minimum gerekli veri).
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  type PersonnelCreateRequest,
  type PersonnelDto,
  type PersonnelListQuery,
  type PersonnelUpdateRequest,
} from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';
import { SyncEventsService } from '../../common/sync-events.service.js';

const PERSONNEL_INCLUDE = {
  _count: { select: { attendanceRecords: true } },
} satisfies Prisma.PersonnelInclude;

@Injectable()
export class PersonnelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly syncEvents: SyncEventsService,
  ) {}

  private static toDto(row: Prisma.PersonnelGetPayload<{ include: typeof PERSONNEL_INCLUDE }>): PersonnelDto {
    return {
      id: row.id,
      employeeCode: row.employeeCode,
      fullName: row.fullName,
      phone: row.phone,
      jobTitle: row.jobTitle,
      companyOrSubcontractor: row.companyOrSubcontractor,
      status: row.status,
      attendanceRecordCount: row._count.attendanceRecords,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ---------- Liste ----------

  async list(query: PersonnelListQuery) {
    const where: Prisma.PersonnelWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { fullName: { contains: query.search, mode: 'insensitive' as const } },
              { employeeCode: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.PersonnelOrderByWithRelationInput =
      query.sort === 'createdAt' ? { createdAt: query.order } : { [query.sort]: query.order };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.personnel.count({ where }),
      this.prisma.personnel.findMany({
        where,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: PERSONNEL_INCLUDE,
      }),
    ]);

    return { data: rows.map(PersonnelService.toDto), meta: buildPaginationMeta(query.page, query.pageSize, total) };
  }

  // ---------- Detay ----------

  async detail(id: string): Promise<PersonnelDto> {
    const row = await this.prisma.personnel.findUnique({ where: { id }, include: PERSONNEL_INCLUDE });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Personel bulunamadı' });
    return PersonnelService.toDto(row);
  }

  // ---------- Oluşturma ----------

  async create(
    actorUserId: string,
    input: PersonnelCreateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<PersonnelDto> {
    if (input.employeeCode) {
      const existing = await this.prisma.personnel.findUnique({ where: { employeeCode: input.employeeCode } });
      if (existing) {
        throw new ConflictException({ code: 'CONFLICT', message: 'Bu sicil numarası başka bir personele ait' });
      }
    }

    const row = await this.prisma.personnel.create({
      data: {
        employeeCode: input.employeeCode,
        fullName: input.fullName,
        phone: input.phone,
        jobTitle: input.jobTitle,
        companyOrSubcontractor: input.companyOrSubcontractor,
        status: input.status,
        createdById: actorUserId,
      },
      include: PERSONNEL_INCLUDE,
    });

    await this.audit.record({
      actorUserId,
      action: 'personnel.created',
      entityType: 'Personnel',
      entityId: row.id,
      after: { fullName: row.fullName, employeeCode: row.employeeCode, status: row.status },
      ...meta,
    });

    // Faz 09: personel kartı çevrimdışı puantaj ekranları için pull'a girer.
    await this.syncEvents.record({
      entityType: 'personnel',
      entityId: row.id,
      operation: 'upsert',
      actorId: actorUserId,
    });

    return PersonnelService.toDto(row);
  }

  // ---------- Güncelleme / pasife alma ----------

  async update(
    actorUserId: string,
    id: string,
    input: PersonnelUpdateRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<PersonnelDto> {
    const current = await this.prisma.personnel.findUnique({ where: { id }, include: PERSONNEL_INCLUDE });
    if (!current) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Personel bulunamadı' });

    if (input.employeeCode && input.employeeCode !== current.employeeCode) {
      const clash = await this.prisma.personnel.findUnique({ where: { employeeCode: input.employeeCode } });
      if (clash) {
        throw new ConflictException({ code: 'CONFLICT', message: 'Bu sicil numarası başka bir personele ait' });
      }
    }

    // Pasife alma: puantaj geçmişi korunur; yeni kayıt serviste engellenir.
    const row = await this.prisma.personnel.update({
      where: { id },
      data: {
        employeeCode: input.employeeCode !== undefined ? input.employeeCode : undefined,
        fullName: input.fullName,
        phone: input.phone !== undefined ? input.phone : undefined,
        jobTitle: input.jobTitle !== undefined ? input.jobTitle : undefined,
        companyOrSubcontractor: input.companyOrSubcontractor !== undefined ? input.companyOrSubcontractor : undefined,
        status: input.status,
      },
      include: PERSONNEL_INCLUDE,
    });

    await this.audit.record({
      actorUserId,
      action: input.status === 'PASSIVE' && current.status === 'ACTIVE' ? 'personnel.deactivated' : 'personnel.updated',
      entityType: 'Personnel',
      entityId: row.id,
      before: { fullName: current.fullName, status: current.status, employeeCode: current.employeeCode },
      after: { fullName: row.fullName, status: row.status, employeeCode: row.employeeCode },
      ...meta,
    });

    await this.syncEvents.record({
      entityType: 'personnel',
      entityId: row.id,
      operation: 'upsert',
      actorId: actorUserId,
    });

    return PersonnelService.toDto(row);
  }
}
