import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { EmptyState } from '@/components/ui/States';

export interface ModuleShellPageProps {
  title: string;
  moduleName: string;
  phaseNo: string;
  phaseScope: string;
  children?: ReactNode;
}

/**
 * Sonraki fazlarda dolacak modül sayfaları için ortak kabuk.
 * Sahte veri yerine, modülün hangi fazda geleceğini açıkça belirten boş durum gösterilir.
 */
export function ModuleShellPage({ title, moduleName, phaseNo, phaseScope, children }: ModuleShellPageProps) {
  return (
    <AppShell title={title}>
      <PageHeader title={title} description={`${moduleName} modülü — uygulama kabuğu Faz 01 kapsamında hazır`} />
      <EmptyState
        title={`${moduleName} modülü Faz ${phaseNo}'de eklenecek`}
        description={phaseScope}
      />
      {children}
    </AppShell>
  );
}
