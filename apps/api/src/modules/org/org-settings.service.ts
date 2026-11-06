/**
 * Kurum ayarları servisi (Faz 06).
 *
 * Faz 06 geliştirme promptu: varsayılan devam durumları "kurum ayarıyla
 * genişletilebilir". Singleton OrgSettings satırı bu uzantıyı tutar
 * ({ key, label } listesi); birleşik liste contracts.availableAttendanceStatuses
 * ile API/UI/mobil tarafında aynı şekilde üretilir.
 *
 * Değiştirme yetkisi yalnızca FIRM_SETTINGS_MANAGE (docs/06 "Firma ayarı" satırı);
 * güncelleme audit log üretir (docs/07: rol/ayar değişiklikleri denetlenir).
 *
 * Faz 10: yedekleme durumu (docs/10) — backup script'i (infra/scripts/backup.sh)
 * status.json yazar; bu servis dosyayı YALNIZCA OKUR ve şemaya doğrulayıp döner.
 * Uygulama içinden restore başlatılmaz (docs/10: kontrollü operasyon script'i).
 */
import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import type { BackupStatus, CustomAttendanceStatus, OrgSettingsDto, UpdateOrgSettingsRequest } from '@santiyepro/contracts';
import { backupStatusFileSchema } from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';

export const ORG_SETTINGS_ID = 'default';

const EMPTY_BACKUP_STATUS: BackupStatus = {
  statusFileFound: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastDbBackupFile: null,
  lastDbBackupSizeBytes: null,
  lastStorageBackupFile: null,
  lastStorageBackupSizeBytes: null,
  retentionDays: null,
};

@Injectable()
export class OrgSettingsService {
  private readonly logger = new Logger(OrgSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private static customStatusesOf(raw: unknown): CustomAttendanceStatus[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is CustomAttendanceStatus =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as CustomAttendanceStatus).key === 'string' &&
        typeof (item as CustomAttendanceStatus).label === 'string',
    );
  }

  private static toDto(raw: unknown): OrgSettingsDto {
    return { attendanceCustomStatuses: OrgSettingsService.customStatusesOf(raw) };
  }

  /** Singleton satırını okur; yoksa oluşturur (ilk erişimde). */
  async get(): Promise<OrgSettingsDto> {
    const row = await this.prisma.orgSettings.upsert({
      where: { id: ORG_SETTINGS_ID },
      update: {},
      create: { id: ORG_SETTINGS_ID },
    });
    return OrgSettingsService.toDto(row.attendanceCustomStatuses);
  }

  async update(
    actorUserId: string,
    input: UpdateOrgSettingsRequest,
    meta: { ip: string; userAgent: string; traceId?: string },
  ): Promise<OrgSettingsDto> {
    const current = await this.prisma.orgSettings.upsert({
      where: { id: ORG_SETTINGS_ID },
      update: {},
      create: { id: ORG_SETTINGS_ID },
    });
    const before = OrgSettingsService.toDto(current.attendanceCustomStatuses);

    const row = await this.prisma.orgSettings.update({
      where: { id: ORG_SETTINGS_ID },
      data: { attendanceCustomStatuses: input.attendanceCustomStatuses },
    });

    await this.audit.record({
      actorUserId,
      action: 'org.settings.updated',
      entityType: 'OrgSettings',
      entityId: ORG_SETTINGS_ID,
      before: { attendanceCustomStatuses: before.attendanceCustomStatuses },
      after: { attendanceCustomStatuses: input.attendanceCustomStatuses },
      ...meta,
    });

    return OrgSettingsService.toDto(row.attendanceCustomStatuses);
  }

  /**
   * Yedekleme durumu (Faz 10, docs/10): BACKUP_STATUS_FILE ortam değişkeniyle
   * gösterilen dosyayı okur. Dosya yoksa/bozuksa statusFileFound: false döner —
   * durum hiçbir zaman uydurulmaz; yönetici "hiç yedek alınmamış" görür.
   */
  async getBackupStatus(): Promise<BackupStatus> {
    const path = process.env.BACKUP_STATUS_FILE;
    if (!path) return EMPTY_BACKUP_STATUS;
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = backupStatusFileSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        this.logger.warn(`Backup status dosyası şemaya uymuyor: ${path}`);
        return EMPTY_BACKUP_STATUS;
      }
      return { ...parsed.data, statusFileFound: true };
    } catch {
      return EMPTY_BACKUP_STATUS;
    }
  }
}
