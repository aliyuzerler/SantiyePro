import { ModuleShellPage } from '@/components/shell/ModuleShellPage';

export default function ReportsPage() {
  return (
    <ModuleShellPage
      title="Raporlar"
      moduleName="Raporlama ve Dışa Aktarma"
      phaseNo="10"
      phaseScope="Proje özeti, puantaj, stok, gider ve hakediş raporları gerçek veriden üretilir; PDF (Türkçe karakter destekli) ve XLSX (gerçek hücre tipleri) çıktısı bu fazda tamamlanır."
    />
  );
}
