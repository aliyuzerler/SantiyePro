/**
 * Faz 06 contracts testleri — Personel ve Puantaj şemaları.
 * prompts/phase-06-test.md kapsamı: her devam durumu, giriş/çıkış validasyonu,
 * durum genişletme (kurum ayarı), tarih biçimi ve toplu işaretleme sözleşmesi.
 */
import { describe, expect, it } from 'vitest';
import {
  availableAttendanceStatuses,
  attendanceStatusLabels,
  bulkAttendanceConfirmRequestSchema,
  createAttendanceRequestSchema,
  dateToWorkDate,
  DEFAULT_ATTENDANCE_STATUSES,
  orgSettingsDtoSchema,
  resolveWorkedMinutes,
  updateOrgSettingsRequestSchema,
  validateAttendanceTimes,
  workDateToDate,
  workDateSchema,
} from '../src/attendance.js';

describe('attendance contracts', () => {
  it('varsayılan 6 devam durumu tanımlıdır', () => {
    expect(DEFAULT_ATTENDANCE_STATUSES).toEqual(['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE', 'SICK', 'HOLIDAY']);
  });

  it('kurum özel durumları varsayılanlarla birleşir ve tekrar içermez', () => {
    const merged = availableAttendanceStatuses([
      { key: 'OVERTIME_REST', label: 'Mesai İstirahati' },
      { key: 'PRESENT', label: 'Kopya' },
    ]);
    expect(merged).toEqual([...DEFAULT_ATTENDANCE_STATUSES, 'OVERTIME_REST']);
    expect(attendanceStatusLabels([{ key: 'OVERTIME_REST', label: 'Mesai İstirahati' }]).OVERTIME_REST).toBe(
      'Mesai İstirahati',
    );
  });

  it('workDate yalnızca YYYY-MM-DD kabul eder', () => {
    expect(workDateSchema.safeParse('2026-06-01').success).toBe(true);
    expect(workDateSchema.safeParse('01.06.2026').success).toBe(false);
    expect(workDateSchema.safeParse('2026-6-1').success).toBe(false);
  });

  it('saha dışı durumlarda giriş/çıkış ve süre girilemez', () => {
    expect(
      validateAttendanceTimes({ status: 'ABSENT', checkInAt: '2026-06-01T08:00:00.000Z' }).valid,
    ).toBe(false);
    expect(validateAttendanceTimes({ status: 'LEAVE', workedMinutes: 120 }).valid).toBe(false);
    expect(validateAttendanceTimes({ status: 'SICK' }).valid).toBe(true);
    expect(validateAttendanceTimes({ status: 'HOLIDAY' }).valid).toBe(true);
  });

  it('çıkış girişten sonra olmalıdır; PRESENT/ Half-day saat içerebilir', () => {
    expect(
      validateAttendanceTimes({
        status: 'PRESENT',
        checkInAt: '2026-06-01T14:00:00.000Z',
        checkOutAt: '2026-06-01T09:00:00.000Z',
      }).valid,
    ).toBe(false);
    expect(
      validateAttendanceTimes({
        status: 'HALF_DAY',
        checkInAt: '2026-06-01T08:00:00.000Z',
        checkOutAt: '2026-06-01T12:00:00.000Z',
      }).valid,
    ).toBe(true);
  });

  it('workedMinutes her iki saat de girilmişse hesaplanır', () => {
    expect(
      resolveWorkedMinutes({
        checkInAt: '2026-06-01T08:00:00.000Z',
        checkOutAt: '2026-06-01T17:00:00.000Z',
      }),
    ).toBe(540);
    expect(resolveWorkedMinutes({ workedMinutes: 240 })).toBe(240);
    expect(resolveWorkedMinutes({})).toBeNull();
  });

  it('create isteğinde vardiya anahtarı varsayılan GUNDUZ', () => {
    const parsed = createAttendanceRequestSchema.parse({
      projectId: 'p1',
      personnelId: 'x1',
      workDate: '2026-06-01',
    });
    expect(parsed.shiftKey).toBe('GUNDUZ');
    expect(parsed.status).toBe('PRESENT');
  });

  it('toplu onay confirm: true olmadan reddedilir', () => {
    const base = {
      projectId: 'p1',
      workDate: '2026-06-01',
      status: 'PRESENT',
      personnelIds: ['a', 'b'],
    };
    expect(bulkAttendanceConfirmRequestSchema.safeParse(base).success).toBe(false);
    expect(bulkAttendanceConfirmRequestSchema.safeParse({ ...base, confirm: true }).success).toBe(true);
  });

  it('kurum ayarı: özel anahtar biçimi ve varsayılan çakışması denetlenir', () => {
    expect(
      updateOrgSettingsRequestSchema.safeParse({ attendanceCustomStatuses: [{ key: 'ozel_durum', label: 'Küçük Harf' }] })
        .success,
    ).toBe(false);
    expect(
      updateOrgSettingsRequestSchema.safeParse({ attendanceCustomStatuses: [{ key: 'PRESENT', label: 'Kopya' }] })
        .success,
    ).toBe(false);
    expect(
      updateOrgSettingsRequestSchema.safeParse({
        attendanceCustomStatuses: [
          { key: 'OVERTIME_REST', label: 'Mesai İstirahati' },
          { key: 'OVERTIME_REST', label: 'Tekrar' },
        ],
      }).success,
    ).toBe(false);
    expect(orgSettingsDtoSchema.safeParse({ attendanceCustomStatuses: [] }).success).toBe(true);
  });

  it('workDate ↔ Date dönüşümleri UTC takvim gününde kalır', () => {
    const date = workDateToDate('2026-06-01');
    expect(date.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(dateToWorkDate(date)).toBe('2026-06-01');
  });
});
