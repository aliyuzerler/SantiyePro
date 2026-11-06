/**
 * E2e test yardımcıları — FK-sıralı işlem verisi temizliği.
 * Tüm e2e spec'leri aynı paylaşılan test veritabanını kullandığı için temizlik
 * tek yerden yönetilir; yeni tablolar buraya eklenir (Restrict FK'lar önce).
 */
import type { PrismaClient } from '@prisma/client';

export async function resetTransactionalData(prisma: PrismaClient): Promise<void> {
  await prisma.progressClaimLine.deleteMany();
  await prisma.progressClaim.deleteMany();
  await prisma.contractItem.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.expenseCategory.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.stockBalance.deleteMany();
  await prisma.material.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.personnel.deleteMany();
  await prisma.orgSettings.deleteMany();
  await prisma.dailyReportRevision.deleteMany();
  await prisma.dailyReportMedia.deleteMany();
  await prisma.dailyReportWorker.deleteMany();
  await prisma.dailyReport.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.taskStatusHistory.deleteMany();
  await prisma.taskComment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.mediaFile.deleteMany();
  await prisma.site.deleteMany();
  await prisma.project.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.user.deleteMany();
}
