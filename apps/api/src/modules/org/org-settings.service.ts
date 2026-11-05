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
 */
import { Injectable } from '@nestjs/common';
import type { CustomAttendanceStatus, OrgSettingsDto, UpdateOrgSettingsRequest } from '@santiyepro/contracts';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit.service.js';

export const ORG_SETTINGS_ID = 'default';

@Injectable()
export class OrgSettingsService {
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
}
