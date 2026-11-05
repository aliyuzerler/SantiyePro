import { ModuleShellPage } from '@/components/shell/ModuleShellPage';

export default function SettingsPage() {
  return (
    <ModuleShellPage
      title="Ayarlar"
      moduleName="Firma/Kurulum Ayarları"
      phaseNo="10"
      phaseScope="Firma bilgileri, saat dilimi/para birimi, yedekleme durumu ve sistem ayarları bu fazda uygulanır. Audit log görüntüleme yetkili kullanıcıya açılır."
    />
  );
}
