/**
 * Faz 10 birim testleri — rapor dışa aktarma ve yedekleme durumu.
 *
 * Kapsam (prompts/phase-10-test.md):
 * - XLSX hücreleri GERÇEK sayı/tarih tipinde mi?
 * - PDF Türkçe karakterli gömülü fontla üretiliyor mu?
 * - Büyük veri export satır sınırıyla mı engelleniyor?
 * - Export audit log üretiyor mu (report.exported + filtre kanıtı)?
 * - Rapor desteklemeyen durum filtresi reddediliyor mu?
 * - Backup status dosyası bozuk/eksikse uydurma durum gösterilmiyor mu?
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  BadRequestException,
  OrgSettingsService,
  ReportExportService,
} from './helpers/exports.js';
import type { ProjectOverviewRow, ReportKey } from '@santiyepro/contracts';

function overviewRow(overrides: Partial<ProjectOverviewRow> = {}): ProjectOverviewRow {
  return {
    projectId: 'p1',
    projectCode: 'P-1',
    projectName: 'Şantiye Ğü İştı Ö',
    projectStatus: 'ACTIVE',
    taskTotal: 5,
    taskDone: 2,
    taskActive: 3,
    taskOverdue: 1,
    dailyReportTotal: 4,
    dailyReportApproved: 3,
    dailyReportSubmitted: 1,
    attendanceRecordCount: 7,
    stockMovementCount: 2,
    expenseApprovedTotal: '1500.50',
    expensePendingTotal: '250.00',
    expenseCurrency: 'TRY',
    expenseMixedCurrency: false,
    claimApprovedNetTotal: '99999.99',
    lastActivityAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  };
}

interface CapturedAudit {
  action: string;
  entityType: string;
  entityId?: string | null;
  after?: unknown;
}

function makeDeps(rows: ProjectOverviewRow[], rowKey: ReportKey = 'project-overview') {
  const audits: CapturedAudit[] = [];
  const fakeReports = {
    projectOverview: () => Promise.resolve({ data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length, totalPages: 1 } }),
    dailyReportSummary: () => Promise.resolve({ data: [], meta: { page: 1, pageSize: 0, total: 0, totalPages: 0 } }),
    attendanceReport: () => Promise.resolve({ data: [], meta: { page: 1, pageSize: 0, total: 0, totalPages: 0 } }),
    stockBalance: () => Promise.resolve({ data: [], meta: { page: 1, pageSize: 0, total: 0, totalPages: 0 } }),
    stockMovements: () => Promise.resolve({ data: [], meta: { page: 1, pageSize: 0, total: 0, totalPages: 0 } }),
    expenseSummary: () => Promise.resolve({ data: [], meta: { page: 1, pageSize: 0, total: 0, totalPages: 0 } }),
    claimSummary: () => Promise.resolve({ data: [], meta: { page: 1, pageSize: 0, total: 0, totalPages: 0 } }),
    taskStatus: () => Promise.resolve({ data: [], meta: { page: 1, pageSize: 0, total: 0, totalPages: 0 } }),
  };
  void rowKey;
  const fakeAudit = {
    record: (entry: CapturedAudit) => {
      audits.push(entry);
      return Promise.resolve({ id: 'audit-1' });
    },
  };
  const service = new ReportExportService(fakeReports as never, fakeAudit as never);
  return { service, audits };
}

const META = { ip: '127.0.0.1', userAgent: 'vitest', traceId: 't1' };
const QUERY = { format: 'xlsx' as const };

beforeAll(() => {
  process.env.EXPORT_ROW_LIMIT_BACKUP = process.env.EXPORT_ROW_LIMIT;
});

afterAll(() => {
  if (process.env.EXPORT_ROW_LIMIT_BACKUP !== undefined) {
    process.env.EXPORT_ROW_LIMIT = process.env.EXPORT_ROW_LIMIT_BACKUP;
  } else {
    delete process.env.EXPORT_ROW_LIMIT;
  }
  delete process.env.EXPORT_ROW_LIMIT_BACKUP;
});

describe('XLSX dışa aktarma — gerçek hücre tipleri', () => {
  it('sayıları sayı, tarihleri tarih hücresi olarak yazar; Türkçe karakterler bozulmaz', async () => {
    const { service } = makeDeps([overviewRow()]);
    const result = await service.exportReport('user-1', 'project-overview', 'xlsx', { ...QUERY }, META);
    expect(result.filename.endsWith('.xlsx')).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).getCell(1).value).toBe('Proje Kodu');

    const row = ws.getRow(2);
    // Metin hücresi
    expect(row.getCell(1).value).toBe('P-1');
    expect(row.getCell(2).value).toBe('Şantiye Ğü İştı Ö');
    // Sayı hücreleri GERÇEK number tipinde
    expect(typeof row.getCell(4).value).toBe('number'); // Görev
    expect(row.getCell(4).value).toBe(5);
    expect(typeof row.getCell(11).value).toBe('number'); // Onaylı gider
    expect(row.getCell(11).value).toBe(1500.5);
    // Tarih hücresi GERÇEK Date tipinde (Son Hareket)
    expect(row.getCell(13).value instanceof Date).toBe(true);
    expect((row.getCell(13).value as Date).toISOString()).toBe('2026-11-05T10:00:00.000Z');
    // Para kolonu formatı 2 ondalık gösterime ayarlı
    expect(ws.getColumn(11).numFmt).toBe('#,##0.00');
  });
});

describe('PDF dışa aktarma — Türkçe karakter desteği', () => {
  it('DejaVu fontu gömer ve geçerli PDF üretir', async () => {
    const { service } = makeDeps([overviewRow(), overviewRow({ projectId: 'p2', projectCode: 'P-2' })]);
    const result = await service.exportReport('user-1', 'project-overview', 'pdf', { ...QUERY, format: 'pdf' }, META);
    const text = result.buffer.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('DejaVu'); // gömülü Türkçe karakterli font
    expect(result.buffer.length).toBeGreaterThan(1000);
    expect(result.filename.endsWith('.pdf')).toBe(true);
  });
});

describe('Export denetim günlüğü', () => {
  it('report.exported kaydı yazar: format, satır sayısı ve filtreler after gövdesinde', async () => {
    const { service, audits } = makeDeps([overviewRow()]);
    const result = await service.exportReport('user-1', 'project-overview', 'xlsx', { ...QUERY, dateFrom: '2026-01-01', dateTo: '2026-01-31' }, META);
    expect(result.auditLogId).toBe('audit-1');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('report.exported');
    expect(audits[0]!.entityType).toBe('Report');
    expect(audits[0]!.entityId).toBe('project-overview');
    const after = audits[0]!.after as { format: string; rowCount: number; filters: Record<string, unknown> };
    expect(after.format).toBe('xlsx');
    expect(after.rowCount).toBe(1);
    expect(after.filters.dateFrom).toBe('2026-01-01');
  });

  it('raporun desteklemediği durum filtresi 400 ile reddedilir', async () => {
    const { service } = makeDeps([overviewRow()]);
    // project-overview raporunda status filtresi yoktur
    await expect(
      service.exportReport('user-1', 'project-overview', 'xlsx', { ...QUERY, status: 'APPROVED' }, META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Büyük veri export sınırı (docs/08)', () => {
  it('satır sınırı aşıldığında 400 döner ve daraltma önerir', async () => {
    process.env.EXPORT_ROW_LIMIT = '5';
    const many = Array.from({ length: 6 }, (_, i) => overviewRow({ projectId: `p${i}`, projectCode: `P-${i}` }));
    const { service } = makeDeps(many);
    await expect(service.exportReport('user-1', 'project-overview', 'xlsx', { ...QUERY }, META)).rejects.toThrow(
      /satırdan büyük|daraltın|EXPORT_ROW_LIMIT/s,
    );
  });

  it('sınır tam içindeyse export başarılıdır', async () => {
    process.env.EXPORT_ROW_LIMIT = '6';
    const many = Array.from({ length: 6 }, (_, i) => overviewRow({ projectId: `p${i}`, projectCode: `P-${i}` }));
    const { service } = makeDeps(many);
    const result = await service.exportReport('user-1', 'project-overview', 'xlsx', { ...QUERY }, META);
    expect(result.rowCount).toBe(6);
  });
});

describe('Yedekleme durumu (docs/10 — uydurma yasak)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'santiyepro-backup-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const makeService = () => new OrgSettingsService({} as never, {} as never);

  it('BACKUP_STATUS_FILE yoksa statusFileFound: false döner', async () => {
    delete process.env.BACKUP_STATUS_FILE;
    const status = await makeService().getBackupStatus();
    expect(status.statusFileFound).toBe(false);
    expect(status.lastSuccessAt).toBeNull();
  });

  it('geçerli status.json dosyasını şemaya doğrulayıp döner', async () => {
    const file = join(dir, 'status-valid.json');
    await writeFile(
      file,
      JSON.stringify({
        lastRunAt: '2026-11-05T23:00:00Z',
        lastSuccessAt: '2026-11-05T23:00:05Z',
        lastError: null,
        lastDbBackupFile: '/backups/db-20261105.dump',
        lastDbBackupSizeBytes: 4096,
        lastStorageBackupFile: null,
        lastStorageBackupSizeBytes: null,
        retentionDays: 30,
      }),
      'utf8',
    );
    process.env.BACKUP_STATUS_FILE = file;
    const status = await makeService().getBackupStatus();
    expect(status.statusFileFound).toBe(true);
    expect(status.lastSuccessAt).toBe('2026-11-05T23:00:05Z');
    expect(status.lastDbBackupSizeBytes).toBe(4096);
    expect(status.retentionDays).toBe(30);
    delete process.env.BACKUP_STATUS_FILE;
  });

  it('bozuk dosyada uydurma yapmaz: statusFileFound: false', async () => {
    const file = join(dir, 'status-broken.json');
    await writeFile(file, '{ bozuk json', 'utf8');
    process.env.BACKUP_STATUS_FILE = file;
    const status = await makeService().getBackupStatus();
    expect(status.statusFileFound).toBe(false);
    expect(status.lastSuccessAt).toBeNull();
    delete process.env.BACKUP_STATUS_FILE;
  });

  it('şemaya uymayan dosyada uydurma yapmaz (eksik alan)', async () => {
    const file = join(dir, 'status-invalid.json');
    await writeFile(file, JSON.stringify({ lastRunAt: '2026-11-05T23:00:00Z' }), 'utf8');
    process.env.BACKUP_STATUS_FILE = file;
    const status = await makeService().getBackupStatus();
    expect(status.statusFileFound).toBe(false);
    delete process.env.BACKUP_STATUS_FILE;
  });
});
