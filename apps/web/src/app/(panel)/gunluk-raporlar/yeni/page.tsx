'use client';

import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { ReportForm } from '@/components/daily-reports/ReportForm';

/** Yeni günlük rapor sayfası (Faz 05) — mobil öncelikli formun web sürümü. */
export default function NewDailyReportPage() {
  return (
    <AppShell title="Yeni Günlük Rapor">
      <PageHeader
        title="Yeni Günlük Rapor"
        description="Şantiye günü: hava durumu, yapılan işler, ekip özeti, ekipman, sorunlar, İSG notu ve ertesi gün planı."
      />
      <div className="max-w-3xl">
        <ReportForm />
      </div>
    </AppShell>
  );
}
