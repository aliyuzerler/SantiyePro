/**
 * Faz 05 sözleşme testleri — günlük rapor durum makinesi, ekip satırı ve medya allowlist.
 */
import { describe, expect, it } from 'vitest';
import {
  DAILY_REPORT_STATUSES,
  MEDIA_MAX_SIZE_BYTES,
  MEDIA_MIME_ALLOWLIST,
  canTransitionDailyReportStatus,
  completeMediaUploadSchema,
  createDailyReportRequestSchema,
  nextDailyReportStatuses,
  rejectDailyReportRequestSchema,
  requestMediaUploadUrlSchema,
  updateDailyReportRequestSchema,
  workHoursSchema,
} from '../src/index.js';

describe('günlük rapor durum makinesi', () => {
  it('geçerli geçişler kabul edilir (docs/05 akışı)', () => {
    expect(canTransitionDailyReportStatus('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransitionDailyReportStatus('SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransitionDailyReportStatus('SUBMITTED', 'REJECTED')).toBe(true);
    expect(canTransitionDailyReportStatus('REJECTED', 'DRAFT')).toBe(true);
    expect(canTransitionDailyReportStatus('REJECTED', 'SUBMITTED')).toBe(true); // doğrudan yeniden gönderim
  });

  it('geçersiz geçişler reddedilir', () => {
    expect(canTransitionDailyReportStatus('DRAFT', 'APPROVED')).toBe(false);
    expect(canTransitionDailyReportStatus('DRAFT', 'REJECTED')).toBe(false);
    expect(canTransitionDailyReportStatus('APPROVED', 'REJECTED')).toBe(false);
    expect(canTransitionDailyReportStatus('APPROVED', 'DRAFT')).toBe(false);
    expect(canTransitionDailyReportStatus('SUBMITTED', 'SUBMITTED')).toBe(false);
  });

  it('terminal durumdan çıkış yok; UI hedefleri matrisle uyumlu', () => {
    expect(nextDailyReportStatuses('APPROVED')).toEqual([]);
    expect(nextDailyReportStatuses('DRAFT')).toEqual(['SUBMITTED']);
    expect(nextDailyReportStatuses('SUBMITTED')).toEqual(['APPROVED', 'REJECTED']);
    expect(DAILY_REPORT_STATUSES).toHaveLength(4);
  });
});

describe('günlük rapor şemaları', () => {
  const validBase = {
    projectId: 'prj-1',
    reportDate: '2026-11-05',
    workSummary: 'Zemin kat kalıp montajı tamamlandı.',
  };

  it('geçerli oluşturma isteği; workers varsayılanı uygulanır', () => {
    const parsed = createDailyReportRequestSchema.parse({
      ...validBase,
      workers: [{ name: 'Ahmet Yılmaz', hours: '8' }],
    });
    expect(parsed.workers?.[0]?.workerCount).toBe(1);
  });

  it('zorunlu alanlar: kısa workSummary ve bozuk tarih → hata', () => {
    expect(createDailyReportRequestSchema.safeParse({ ...validBase, workSummary: 'ab' }).success).toBe(false);
    expect(
      createDailyReportRequestSchema.safeParse({ ...validBase, reportDate: '05.11.2026' }).success,
    ).toBe(false);
  });

  it('saat sınırı: 24 ve üzeri reddedilir, ondalık kabul edilir', () => {
    expect(workHoursSchema.safeParse('8.5').success).toBe(true);
    expect(workHoursSchema.safeParse('24').success).toBe(true);
    expect(workHoursSchema.safeParse('25').success).toBe(false);
    expect(workHoursSchema.safeParse('8,5').success).toBe(false);
  });

  it('güncelleme boş olamaz; red gerekçesi zorunludur', () => {
    expect(updateDailyReportRequestSchema.safeParse({}).success).toBe(false);
    expect(rejectDailyReportRequestSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(rejectDailyReportRequestSchema.safeParse({ reason: 'Hava durumu verisi eksik' }).success).toBe(true);
  });

  it('medya allowlist: SVG yasağı ve boyut üst sınırı (docs/07)', () => {
    expect(MEDIA_MIME_ALLOWLIST).not.toContain('image/svg+xml');
    expect(MEDIA_MIME_ALLOWLIST).toContain('image/jpeg');
    expect(MEDIA_MAX_SIZE_BYTES).toBe(10 * 1024 * 1024);

    expect(
      requestMediaUploadUrlSchema.safeParse({
        filename: 'plan.pdf',
        mimeType: 'image/svg+xml',
        sizeBytes: 100,
        projectId: 'p1',
      }).success,
    ).toBe(false);
    expect(
      requestMediaUploadUrlSchema.safeParse({
        filename: 'buyuk.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: MEDIA_MAX_SIZE_BYTES + 1,
        projectId: 'p1',
      }).success,
    ).toBe(false);
  });

  it('path traversal içeren dosya adı reddedilir', () => {
    expect(
      requestMediaUploadUrlSchema.safeParse({
        filename: '../../etc/passwd.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        projectId: 'p1',
      }).success,
    ).toBe(false);
    expect(
      completeMediaUploadSchema.safeParse({ mediaId: 'm1' }).success,
    ).toBe(true);
  });
});
