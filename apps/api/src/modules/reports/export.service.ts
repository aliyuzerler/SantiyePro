/**
 * Rapor dışa aktarma servisi (Faz 10).
 *
 * Kurallar (prompts/phase-10-development.md, docs/08):
 * - XLSX hücreleri GERÇEK tiptedir: sayılar sayı, tarihler tarih hücresi olarak
 *   yazılır (exceljs numFmt ile); para iki ondalık, miktar üç ondalık gösterilir.
 * - PDF DejaVu Sans gömülü fontla üretilir — Türkçe karakterler (ğ, ş, İ, ı)
 *   sorunsız çıkar; standart Helvetica AFM fontu kullanılmaz (WinAnsi eksikliği).
 * - Satır sınırı: EXPORT_ROW_LIMIT (varsayılan 10000). Aşımında 400 döner ve
 *   sınır mesajda açıklanır (docs/08: ilk sürümde makul hacim sınırı belgeli).
 * - Her export AUDIT LOG üretir: action=report.exported, after={format, rowCount,
 *   filters} — Kim hangi raporu hangi filtreyle aldığı denetlenebilir (docs/07).
 * - Filtreler ekrandakiyle AYNI servis katmanından geçer; ekran ve çıktı
 *   asla ayrışmaz.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  CLAIM_STATUSES,
  DAILY_REPORT_STATUSES,
  EXPENSE_STATUSES,
  REPORT_KEY_LABELS,
  REPORT_PERMISSIONS,
  type ReportExportFormat,
  type ReportExportQuery,
  type ReportKey,
} from '@santiyepro/contracts';
import { AuditService } from '../../common/audit.service.js';
import { ReportsService } from './reports.service.js';

export interface ExportMeta {
  ip: string;
  userAgent: string;
  traceId?: string;
}

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
  rowCount: number;
  auditLogId: string | null;
}

type CellValue = string | number | Date | null;
type CellType = 'text' | 'number' | 'money' | 'qty' | 'date' | 'datetime';

interface ColumnSpec {
  header: string;
  /** PDF sütun genişliği (puan); XLSX kolon genişliği olarak da kullanılır. */
  width: number;
  align: 'left' | 'right';
  type: CellType;
  value: (row: Record<string, unknown>) => CellValue;
}

interface TableSpec {
  title: string;
  columns: ColumnSpec[];
  rows: Record<string, unknown>[];
}

const NUM_FMT: Partial<Record<CellType, string>> = {
  money: '#,##0.00',
  qty: '#,##0.000',
  date: 'dd.mm.yyyy',
  datetime: 'dd.mm.yyyy hh:mm',
};

@Injectable()
export class ReportExportService {
  private readonly logger = new Logger(ReportExportService.name);
  /** docs/08: ilk sürümde makul veri hacmi sınırı — env ile ayarlanabilir. */
  private readonly rowLimit = Math.max(1, Number(process.env.EXPORT_ROW_LIMIT ?? '10000'));

  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  async exportReport(
    userId: string,
    key: ReportKey,
    format: ReportExportFormat,
    query: ReportExportQuery,
    meta: ExportMeta,
  ): Promise<ExportResult> {
    const table = await this.collect(userId, key, query);
    if (table.rows.length > this.rowLimit) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Rapor ${this.rowLimit.toLocaleString('tr-TR')} satırdan büyük; lütfen tarih aralığını veya proje filtresini daraltın (EXPORT_ROW_LIMIT)`,
      });
    }

    const stamp = new Date();
    const filename = `santiyepro-${key}-${stamp.toISOString().slice(0, 10)}.` + (format === 'pdf' ? 'pdf' : 'xlsx');
    const buffer =
      format === 'xlsx' ? await this.buildXlsx(table) : await this.buildPdf(table, query, stamp);
    const contentType =
      format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf';

    const entry = await this.audit.record({
      actorUserId: userId,
      action: 'report.exported',
      entityType: 'Report',
      entityId: key,
      after: { format, rowCount: table.rows.length, permission: REPORT_PERMISSIONS[key], filters: query },
      ...meta,
    });
    this.logger.log(`Export: ${key} → ${format}, ${table.rows.length} satır, audit=${entry?.id ?? 'YAZILAMADI'}`);

    return { buffer, filename, contentType, rowCount: table.rows.length, auditLogId: entry?.id ?? null };
  }

  /** Bu raporlar durum filtresi kabul eder; diğerlerinde status gönderimi 400'dür. */
  private static readonly STATUS_AWARE_KEYS: ReadonlySet<string> = new Set([
    'daily-reports',
    'attendance',
    'expense-summary',
    'claim-summary',
  ]);

  /** Satırları rapor servisinden toplar — ekranla aynı yol, sayfalama limit dışı. */
  private async collect(userId: string, key: ReportKey, query: ReportExportQuery): Promise<TableSpec> {
    if (query.status !== undefined && !ReportExportService.STATUS_AWARE_KEYS.has(key)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Bu rapor '${query.status}' durum filtresini desteklemiyor`,
      });
    }
    const filters = {
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      projectId: query.projectId,
      siteId: query.siteId,
      page: 1,
      pageSize: this.rowLimit + 1,
    };
    const spec = this.tableSpec(key);
    switch (key) {
      case 'project-overview': {
        const res = await this.reports.projectOverview(userId, { ...filters });
        return { ...spec, rows: res.data as unknown as Record<string, unknown>[] };
      }
      case 'daily-reports': {
        const res = await this.reports.dailyReportSummary(userId, {
          ...filters,
          status: this.statusAs(DAILY_REPORT_STATUSES, query.status),
        });
        return { ...spec, rows: res.data as unknown as Record<string, unknown>[] };
      }
      case 'attendance': {
        const res = await this.reports.attendanceReport(userId, {
          ...filters,
          status: query.status,
        });
        return { ...spec, rows: res.data as unknown as Record<string, unknown>[] };
      }
      case 'stock-balance': {
        const res = await this.reports.stockBalance(userId, {
          ...filters,
          warehouseId: query.warehouseId,
          materialId: query.materialId,
          belowMin: query.belowMin,
        });
        return { ...spec, rows: res.data as unknown as Record<string, unknown>[] };
      }
      case 'stock-movements': {
        const res = await this.reports.stockMovements(userId, {
          ...filters,
          warehouseId: query.warehouseId,
          materialId: query.materialId,
          type: query.type,
        });
        return { ...spec, rows: res.data as unknown as Record<string, unknown>[] };
      }
      case 'expense-summary': {
        const res = await this.reports.expenseSummary(userId, {
          ...filters,
          status: this.statusAs(EXPENSE_STATUSES, query.status),
          categoryId: query.categoryId,
        });
        return { ...spec, rows: res.data as unknown as Record<string, unknown>[] };
      }
      case 'claim-summary': {
        const res = await this.reports.claimSummary(userId, {
          ...filters,
          status: this.statusAs(CLAIM_STATUSES, query.status),
        });
        return { ...spec, rows: res.data as unknown as Record<string, unknown>[] };
      }
      case 'task-status': {
        const res = await this.reports.taskStatus(userId, { ...filters });
        return { ...spec, rows: res.data as unknown as Record<string, unknown>[] };
      }
    }
  }

  /** Rapor desteklemiyorsa status gönderimi 400 ile reddedilir (ekranla tutarlılık). */
  private statusAs<T extends string>(allowed: readonly T[], status: string | undefined): T | undefined {
    if (status === undefined) return undefined;
    if ((allowed as readonly string[]).includes(status)) return status as T;
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: `Bu rapor '${status}' durum filtresini desteklemiyor`,
    });
  }

  // ---------- Tablo tanımları ----------

  private tableSpec(key: ReportKey): TableSpec {
    const str = (row: Record<string, unknown>, field: string): string => (row[field] as string | null) ?? '';
    const num = (row: Record<string, unknown>, field: string): number | null =>
      row[field] === null || row[field] === undefined ? null : Number(row[field]);
    const date = (row: Record<string, unknown>, field: string): Date | null =>
      row[field] ? new Date(row[field] as string) : null;
    const day = (row: Record<string, unknown>, field: string): Date | null =>
      row[field] ? new Date(`${row[field] as string}T00:00:00.000Z`) : null;
    const text = (row: Record<string, unknown>, field: string): string | null =>
      row[field] === null || row[field] === undefined ? null : String(row[field]);
    const breakdown = (row: Record<string, unknown>): string =>
      ((row['statusBreakdown'] as { status: string; count: number }[] | null) ?? [])
        .map((s) => `${s.status}: ${s.count}`)
        .join(', ');

    const title = REPORT_KEY_LABELS[key];
    const TABLE: Record<ReportKey, ColumnSpec[]> = {
      'project-overview': [
        { header: 'Proje Kodu', width: 70, align: 'left', type: 'text', value: (r) => str(r, 'projectCode') },
        { header: 'Proje', width: 110, align: 'left', type: 'text', value: (r) => str(r, 'projectName') },
        { header: 'Durum', width: 55, align: 'left', type: 'text', value: (r) => str(r, 'projectStatus') },
        { header: 'Görev', width: 40, align: 'right', type: 'number', value: (r) => num(r, 'taskTotal') },
        { header: 'Aktif', width: 40, align: 'right', type: 'number', value: (r) => num(r, 'taskActive') },
        { header: 'Geciken', width: 45, align: 'right', type: 'number', value: (r) => num(r, 'taskOverdue') },
        { header: 'Günlük Rapor', width: 60, align: 'right', type: 'number', value: (r) => num(r, 'dailyReportTotal') },
        { header: 'Onaylı GR', width: 55, align: 'right', type: 'number', value: (r) => num(r, 'dailyReportApproved') },
        { header: 'Puantaj Kayıt', width: 60, align: 'right', type: 'number', value: (r) => num(r, 'attendanceRecordCount') },
        { header: 'Stok Hareket', width: 60, align: 'right', type: 'number', value: (r) => num(r, 'stockMovementCount') },
        { header: 'Onaylı Gider', width: 70, align: 'right', type: 'money', value: (r) => num(r, 'expenseApprovedTotal') },
        { header: 'Onaylı Hakediş (Net)', width: 80, align: 'right', type: 'money', value: (r) => num(r, 'claimApprovedNetTotal') },
        { header: 'Son Hareket', width: 80, align: 'left', type: 'datetime', value: (r) => date(r, 'lastActivityAt') },
      ],
      'daily-reports': [
        { header: 'Tarih', width: 60, align: 'left', type: 'date', value: (r) => day(r, 'reportDate') },
        { header: 'Proje', width: 140, align: 'left', type: 'text', value: (r) => str(r, 'projectName') },
        { header: 'Toplam', width: 50, align: 'right', type: 'number', value: (r) => num(r, 'total') },
        { header: 'Taslak', width: 50, align: 'right', type: 'number', value: (r) => num(r, 'draft') },
        { header: 'Gönderildi', width: 60, align: 'right', type: 'number', value: (r) => num(r, 'submitted') },
        { header: 'Onaylı', width: 50, align: 'right', type: 'number', value: (r) => num(r, 'approved') },
        { header: 'Reddedildi', width: 60, align: 'right', type: 'number', value: (r) => num(r, 'rejected') },
        { header: 'Revizyon', width: 55, align: 'right', type: 'number', value: (r) => num(r, 'revisionTotal') },
      ],
      attendance: [
        { header: 'Tarih', width: 60, align: 'left', type: 'date', value: (r) => day(r, 'workDate') },
        { header: 'Proje', width: 130, align: 'left', type: 'text', value: (r) => str(r, 'projectName') },
        { header: 'Kayıt', width: 50, align: 'right', type: 'number', value: (r) => num(r, 'recordCount') },
        { header: 'Çalışma (dk)', width: 70, align: 'right', type: 'number', value: (r) => num(r, 'workedMinutesTotal') },
        { header: 'Durum Dağılımı', width: 160, align: 'left', type: 'text', value: breakdown },
      ],
      'stock-balance': [
        { header: 'Malzeme', width: 130, align: 'left', type: 'text', value: (r) => str(r, 'materialName') },
        { header: 'Kod', width: 70, align: 'left', type: 'text', value: (r) => text(r, 'materialCode') ?? '' },
        { header: 'Depo', width: 110, align: 'left', type: 'text', value: (r) => str(r, 'warehouseName') },
        { header: 'Birim', width: 45, align: 'left', type: 'text', value: (r) => str(r, 'unit') },
        { header: 'Miktar', width: 70, align: 'right', type: 'qty', value: (r) => num(r, 'quantity') },
        { header: 'Min. Stok', width: 65, align: 'right', type: 'qty', value: (r) => num(r, 'minStock') },
        { header: 'Kritik', width: 45, align: 'left', type: 'text', value: (r) => (r['belowMin'] ? 'EVET' : '—') },
      ],
      'stock-movements': [
        { header: 'Tarih', width: 70, align: 'left', type: 'datetime', value: (r) => date(r, 'occurredAt') },
        { header: 'Tip', width: 65, align: 'left', type: 'text', value: (r) => str(r, 'type') },
        { header: 'Malzeme', width: 120, align: 'left', type: 'text', value: (r) => str(r, 'materialName') },
        { header: 'Depo', width: 90, align: 'left', type: 'text', value: (r) => str(r, 'warehouseName') },
        { header: 'Hedef Depo', width: 90, align: 'left', type: 'text', value: (r) => text(r, 'targetWarehouseName') ?? '' },
        { header: 'Miktar', width: 60, align: 'right', type: 'qty', value: (r) => num(r, 'quantity') },
        { header: 'Birim', width: 45, align: 'left', type: 'text', value: (r) => str(r, 'unit') },
        { header: 'Not', width: 90, align: 'left', type: 'text', value: (r) => text(r, 'note') ?? '' },
      ],
      'expense-summary': [
        { header: 'Kategori', width: 120, align: 'left', type: 'text', value: (r) => str(r, 'categoryName') },
        { header: 'Para', width: 40, align: 'left', type: 'text', value: (r) => str(r, 'currency') },
        { header: 'Taslak', width: 70, align: 'right', type: 'money', value: (r) => num(r, 'draftTotal') },
        { header: 'Bekleyen', width: 70, align: 'right', type: 'money', value: (r) => num(r, 'pendingTotal') },
        { header: 'Onaylı', width: 70, align: 'right', type: 'money', value: (r) => num(r, 'approvedTotal') },
        { header: 'Reddedilen', width: 70, align: 'right', type: 'money', value: (r) => num(r, 'rejectedTotal') },
        { header: 'Genel Toplam', width: 80, align: 'right', type: 'money', value: (r) => num(r, 'grandTotal') },
      ],
      'claim-summary': [
        { header: 'Proje', width: 110, align: 'left', type: 'text', value: (r) => str(r, 'projectName') },
        { header: 'Hakediş No', width: 60, align: 'right', type: 'number', value: (r) => num(r, 'claimNo') },
        { header: 'Dönem Baş.', width: 65, align: 'left', type: 'date', value: (r) => day(r, 'periodStart') },
        { header: 'Dönem Sonu', width: 65, align: 'left', type: 'date', value: (r) => day(r, 'periodEnd') },
        { header: 'Durum', width: 60, align: 'left', type: 'text', value: (r) => str(r, 'status') },
        { header: 'Para', width: 40, align: 'left', type: 'text', value: (r) => text(r, 'currency') ?? '—' },
        { header: 'Brüt', width: 80, align: 'right', type: 'money', value: (r) => num(r, 'grossTotal') },
        { header: 'Kesinti', width: 70, align: 'right', type: 'money', value: (r) => num(r, 'deductionTotal') },
        { header: 'Net', width: 80, align: 'right', type: 'money', value: (r) => num(r, 'netTotal') },
        { header: 'Kümülatif', width: 80, align: 'right', type: 'money', value: (r) => num(r, 'cumulativeTotal') },
      ],
      'task-status': [
        { header: 'Proje', width: 150, align: 'left', type: 'text', value: (r) => str(r, 'projectName') },
        { header: 'Yapılacak', width: 55, align: 'right', type: 'number', value: (r) => num(r, 'todo') },
        { header: 'Devam', width: 50, align: 'right', type: 'number', value: (r) => num(r, 'inProgress') },
        { header: 'Engelli', width: 50, align: 'right', type: 'number', value: (r) => num(r, 'blocked') },
        { header: 'Bitti', width: 45, align: 'right', type: 'number', value: (r) => num(r, 'done') },
        { header: 'İptal', width: 45, align: 'right', type: 'number', value: (r) => num(r, 'cancelled') },
        { header: 'Geciken', width: 55, align: 'right', type: 'number', value: (r) => num(r, 'overdue') },
        { header: 'Yaklaşan', width: 55, align: 'right', type: 'number', value: (r) => num(r, 'dueSoon') },
        { header: 'Toplam', width: 50, align: 'right', type: 'number', value: (r) => num(r, 'total') },
      ],
    };
    const columns = TABLE[key];

    return { title, columns, rows: [] };
  }

  // ---------- XLSX ----------

  private async buildXlsx(table: TableSpec): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ŞantiyePro';
    wb.created = new Date();
    const ws = wb.addWorksheet(table.title.slice(0, 31));
    ws.columns = table.columns.map((c) => ({ header: c.header, width: Math.max(10, Math.ceil(c.width / 6.5)) }));
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E5F' } };
    headerRow.alignment = { vertical: 'middle' };

    for (const row of table.rows) {
      const values: (CellValue | { formula?: never })[] = [];
      table.columns.forEach((col, index) => {
        const raw = col.value(row);
        const wsCol = ws.getColumn(index + 1);
        if (raw === null || raw === undefined) values[index] = null;
        else if (col.type === 'text') values[index] = String(raw);
        else if (col.type === 'number' || col.type === 'money' || col.type === 'qty') {
          const n = Number(raw);
          // Sayısal hücre GERÇEK sayı tipinde yazılır; dönüştürülemeyen değer
          // metin olarak değil, boş bırakılarak asla sayı gibi gösterilmez.
          values[index] = Number.isFinite(n) ? n : null;
          if (NUM_FMT[col.type]) wsCol.numFmt = NUM_FMT[col.type];
        } else {
          // Tarih hücresi GERÇEK tarih tipinde yazılır (sayı seri numarası + numFmt).
          const d = raw instanceof Date ? raw : new Date(String(raw));
          values[index] = Number.isNaN(d.getTime()) ? null : d;
          if (NUM_FMT[col.type]) wsCol.numFmt = NUM_FMT[col.type];
        }
      });
      ws.addRow(values);
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.columns.length } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const arrayBuffer = await wb.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer as ArrayBuffer);
  }

  // ---------- PDF ----------

  private fontPath(name: 'DejaVuSans.ttf' | 'DejaVuSans-Bold.ttf'): string {
    // Çalışma dizini ortama göre değişir (apps/api geliştirme, dist üretim):
    // ilk bulunan geçerli yol kullanılır; hiçbiri yoksa pdfkit hatası açık çıkar.
    const candidates = [
      `${process.cwd()}/assets/fonts/${name}`,
      `${process.cwd()}/apps/api/assets/fonts/${name}`,
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) throw new Error(`Font bulunamadı: ${name} (${candidates.join(' | ')})`);
    return found;
  }

  private buildPdf(table: TableSpec, query: ReportExportQuery, stamp: Date): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    doc.registerFont('body', this.fontPath('DejaVuSans.ttf'));
    doc.registerFont('bold', this.fontPath('DejaVuSans-Bold.ttf'));

    const left = doc.page.margins.left;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWeight = table.columns.reduce((sum, c) => sum + c.width, 0);

    // Başlık bloğu
    doc.font('bold').fontSize(15).fillColor('#111111').text(`ŞantiyePro — ${table.title}`, left, 34);
    doc.font('body').fontSize(8).fillColor('#444444');
    const filterParts = [
      query.dateFrom ? `Başlangıç: ${query.dateFrom}` : null,
      query.dateTo ? `Bitiş: ${query.dateTo}` : null,
      query.projectId ? `Proje: ${query.projectId}` : null,
      query.status ? `Durum: ${query.status}` : null,
    ].filter((v): v is string => v !== null);
    doc.text(
      `Oluşturma: ${stamp.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })} · Satır: ${table.rows.length.toLocaleString('tr-TR')}${filterParts.length ? ' · ' + filterParts.join(' · ') : ''}`,
      left,
      52,
    );
    let y = 72;

    const drawHeader = () => {
      doc.font('bold').fontSize(8).fillColor('#FFFFFF');
      const headerFill = doc.rect(left, y, usableWidth, 18).fill('#1F4E5F');
      void headerFill;
      let x = left;
      for (const col of table.columns) {
        const w = (col.width / totalWeight) * usableWidth;
        doc.fillColor('#FFFFFF').text(col.header, x + 3, y + 5, { width: w - 6, align: col.align === 'right' ? 'right' : 'left', ellipsis: true, height: 12 });
        x += w;
      }
      y += 18;
    };
    drawHeader();

    doc.font('body').fontSize(8);
    let zebra = false;
    for (const row of table.rows) {
      if (y > doc.page.height - doc.page.margins.bottom - 14) {
        doc.addPage();
        y = doc.page.margins.top + 8;
        drawHeader();
        doc.font('body').fontSize(8);
      }
      if (zebra) {
        const fill = doc.rect(left, y, usableWidth, 14).fill('#F2F6F7');
        void fill;
      }
      zebra = !zebra;
      let x = left;
      for (const col of table.columns) {
        const w = (col.width / totalWeight) * usableWidth;
        const raw = col.value(row);
        let display: string;
        if (raw === null || raw === undefined) display = '—';
        else if (col.type === 'money') display = Number(raw).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        else if (col.type === 'qty') display = Number(raw).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
        else if (col.type === 'date') display = (raw instanceof Date ? raw : new Date(String(raw))).toLocaleDateString('tr-TR');
        else if (col.type === 'datetime')
          display = (raw instanceof Date ? raw : new Date(String(raw))).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
        else display = String(raw);
        doc.fillColor('#111111').text(display, x + 3, y + 3, {
          width: w - 6,
          align: col.align === 'right' ? 'right' : 'left',
          ellipsis: true,
          height: 11,
          lineBreak: false,
        });
        x += w;
      }
      y += 14;
    }

    // Alt bilgi: sayfa numarası
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.font('body').fontSize(7).fillColor('#777777');
      doc.text(`Sayfa ${i + 1}/${range.count} · ŞantiyePro Rapor Dışa Aktarma · audit: report.exported`, left, doc.page.height - 22, {
        width: usableWidth,
        align: 'center',
        lineBreak: false,
      });
    }

    return new Promise<Buffer>((resolve, reject) => {
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.end();
    });
  }
}
