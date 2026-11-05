import { ModuleShellPage } from '@/components/shell/ModuleShellPage';

export default function ProgressClaimsPage() {
  return (
    <ModuleShellPage
      title="Hakedişler"
      moduleName="Hakediş Dönemleri"
      phaseNo="08"
      phaseScope="Sözleşme kalemleri, dönem miktarları, birim fiyat snapshot'ı, kesintiler ve net tutar hesabı bu fazda uygulanır. Hesaplama önizlemesi onaydan önce gösterilir; onaylı hakediş değiştirilemez."
    />
  );
}
