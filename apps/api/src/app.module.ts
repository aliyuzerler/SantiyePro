import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { DailyReportsModule } from './modules/daily-reports/daily-reports.module.js';
import { PersonnelModule } from './modules/personnel/personnel.module.js';
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { OrgSettingsModule } from './modules/org/org-settings.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { ProgressClaimsModule } from './modules/progress-claims/progress-claims.module.js';
import { SyncModule } from './modules/sync/sync.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { CommonModule } from './common/common.module.js';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard.js';
import { PermissionsGuard } from './common/auth/permissions.guard.js';

/**
 * Modüler monolit kök modülü (ADR-002).
 * Faz 02: Auth (login/refresh/bootstrap/parola akışları), Users/RBAC, AuditLog.
 * Faz 03: Projects/Sites/ProjectMembers (kapsamlı liste, arşivleme, IDOR koruması).
 * Faz 04: Tasks (durum makinesi, checklist, yorum, durum geçmişi, atama bildirimi).
 * Faz 05: Media (private depo + imzalı URL) ve DailyReports (taslak→gönder→onay/red + revizyon).
 * Faz 06: Personnel (pasife alma) + Attendance (duplicate engelli işaretleme,
 *         toplu önizleme/onay, özet) + OrgSettings (özel devam durumları).
 * Faz 07: Inventory — depo/malzeme kataloğu + append-only stok hareketleri
 *         (transfer tek transaction, koşullu atomik bakiye UPDATE, ters kayıt).
 * Faz 08: Expenses (taslak→onay/red; opsiyonel vergi; fiş eki) + ProgressClaims
 *         (sözleşme kalemleri, snapshot fiyat, zincir doğrulaması, dönem
 *         çakışma engeli, onayda dondurma, iptal politikası) — BigInt para matematiği.
 * Faz 10: Reports (7 rapor gerçek veriden + PDF/XLSX export + audit log üretimi),
 *         Audit okuma uçları (audit.view, maskeleme, önce/sonra) ve backup
 *         durum görünümü (org/backup-status — salt okunur, docs/10).
 * Faz 09: Sync — /sync/push (clientMutationId idempotent batch mutation,
 *         accepted/rejected/conflict sonuçları, SyncMutationLog defteri) ve
 *         /sync/pull (SyncEvent seq cursor delta, kapsam filtresi,
 *         accessibleProjectIds ile erişim kaybı bildirimi).
 * Global guard sırası: kimlik doğrulama → izin kontrolü (deny-by-default).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    PrismaModule,
    CommonModule,
    HealthModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    TasksModule,
    MediaModule,
    DailyReportsModule,
    PersonnelModule,
    AttendanceModule,
    OrgSettingsModule,
    InventoryModule,
    ExpensesModule,
    ProgressClaimsModule,
    SyncModule,
    ReportsModule,
    AuditModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
