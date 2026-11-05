import { ModuleShellPage } from '@/components/shell/ModuleShellPage';

export default function ExpensesPage() {
  return (
    <ModuleShellPage
      title="Giderler"
      moduleName="Gider Yönetimi"
      phaseNo="08"
      phaseScope="Gider kaydı, kategori, tedarikçi, tutar/para birimi, fiş eki ve onay/red akışı bu fazda uygulanır. Tutarlar decimal hassasiyetiyle ve sağa hizalı gösterilir."
    />
  );
}
