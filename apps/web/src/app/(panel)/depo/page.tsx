import { ModuleShellPage } from '@/components/shell/ModuleShellPage';

export default function InventoryPage() {
  return (
    <ModuleShellPage
      title="Depo & Malzemeler"
      moduleName="Depo, Malzeme ve Stok"
      phaseNo="07"
      phaseScope="Malzeme kataloğu, depolar, giriş/çıkış/transfer/iade/ters kayıt hareketleri ve stok bakiyesi bu fazda uygulanır. Hareket geçmişi değiştirilemez ve denetlenebilir tutulur."
    />
  );
}
