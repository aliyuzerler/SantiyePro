import { ModuleShellPage } from '@/components/shell/ModuleShellPage';

export default function UsersPage() {
  return (
    <ModuleShellPage
      title="Kullanıcılar & Yetkiler"
      moduleName="Kimlik ve Yetki (RBAC)"
      phaseNo="02"
      phaseScope="Kullanıcı oluşturma, rol atama, devre dışı bırakma ve rol-yetki matrisi bu fazda uygulanır. Giriş akışı refresh token rotasyonu ve audit kaydıyla birlikte gelir."
    />
  );
}
