/**
 * Pull anlık görüntü serileştirici (Faz 09 — docs/09).
 *
 * SyncEvent satırları yalnızca değişiklik İŞARETÇİSİDİR; pull, her işaretçi için
 * entity'nin GÜNCEL durumunu okur. Böylece aynı kaydın arka arkaya 5
 * güncellemesi tek upsert'e indirgenir (delta sıkıştırması) ve hard-delete
 * sonrası kayıp entity doğal olarak tombstone'a döner.
 *
 * Gizlilik: personnel snapshot'ı KVKK minimum veri ilkesiyle yalnızca puantaj
 * ekranının ihtiyaç duyduğu alanları taşır — telefon gibi kişisel veriler
 * senkronizasyon deltasına girmez (docs/07).
 */
import type { PrismaService } from '../../prisma/prisma.service.js';

export interface EntitySnapshot {
  projectId: string | null;
  updatedAt: string;
  data: Record<string, unknown>;
}

type Db = PrismaService;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export async function fetchEntitySnapshot(
  db: Db,
  entityType: string,
  entityId: string,
): Promise<EntitySnapshot | null> {
  switch (entityType) {
    case 'project': {
      const row = await db.project.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        projectId: row.id,
        updatedAt: row.updatedAt.toISOString(),
        data: {
          id: row.id,
          code: row.code,
          name: row.name,
          clientName: row.clientName,
          status: row.status,
          startDate: dateOnly(row.startDate),
          plannedEndDate: dateOnly(row.plannedEndDate),
          contractAmount: row.contractAmount ? row.contractAmount.toString() : null,
          currency: row.currency,
        },
      };
    }
    case 'site': {
      const row = await db.site.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        projectId: row.projectId,
        updatedAt: row.updatedAt.toISOString(),
        data: {
          id: row.id,
          projectId: row.projectId,
          name: row.name,
          address: row.address,
          status: row.status,
        },
      };
    }
    case 'task': {
      const row = await db.task.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        projectId: row.projectId,
        updatedAt: row.updatedAt.toISOString(),
        data: {
          id: row.id,
          projectId: row.projectId,
          siteId: row.siteId,
          title: row.title,
          description: row.description,
          status: row.status,
          priority: row.priority,
          assigneeId: row.assigneeId,
          dueAt: iso(row.dueAt),
          completedAt: iso(row.completedAt),
          checklist: row.checklist,
          version: row.version,
        },
      };
    }
    case 'taskComment': {
      const row = await db.taskComment.findUnique({
        where: { id: entityId },
        include: { task: { select: { projectId: true } } },
      });
      if (!row) return null;
      return {
        projectId: row.task.projectId,
        updatedAt: row.updatedAt.toISOString(),
        data: {
          id: row.id,
          taskId: row.taskId,
          userId: row.userId,
          body: row.body,
          createdAt: row.createdAt.toISOString(),
        },
      };
    }
    case 'dailyReport': {
      const row = await db.dailyReport.findUnique({
        where: { id: entityId },
        include: { workers: { orderBy: { id: 'asc' } } },
      });
      if (!row) return null;
      return {
        projectId: row.projectId,
        updatedAt: row.updatedAt.toISOString(),
        data: {
          id: row.id,
          projectId: row.projectId,
          siteId: row.siteId,
          reportDate: dateOnly(row.reportDate),
          weather: row.weather,
          workSummary: row.workSummary,
          workforceSummary: row.workforceSummary,
          equipmentSummary: row.equipmentSummary,
          issues: row.issues,
          safetyNotes: row.safetyNotes,
          nextDayPlan: row.nextDayPlan,
          status: row.status,
          revisionNo: row.revisionNo,
          rejectedReason: row.rejectedReason,
          workers: row.workers.map((w) => ({
            id: w.id,
            name: w.name,
            jobTitle: w.jobTitle,
            workerCount: w.workerCount,
            hours: w.hours.toString(),
          })),
        },
      };
    }
    case 'attendanceRecord': {
      const row = await db.attendanceRecord.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        projectId: row.projectId,
        updatedAt: row.updatedAt.toISOString(),
        data: {
          id: row.id,
          projectId: row.projectId,
          siteId: row.siteId,
          personnelId: row.personnelId,
          workDate: dateOnly(row.workDate),
          shiftKey: row.shiftKey,
          status: row.status,
          checkInAt: iso(row.checkInAt),
          checkOutAt: iso(row.checkOutAt),
          workedMinutes: row.workedMinutes,
          note: row.note,
        },
      };
    }
    case 'personnel': {
      const row = await db.personnel.findUnique({ where: { id: entityId } });
      if (!row) return null;
      return {
        projectId: null,
        updatedAt: row.updatedAt.toISOString(),
        data: {
          id: row.id,
          employeeCode: row.employeeCode,
          fullName: row.fullName,
          jobTitle: row.jobTitle,
          status: row.status,
        },
      };
    }
    default:
      return null;
  }
}
