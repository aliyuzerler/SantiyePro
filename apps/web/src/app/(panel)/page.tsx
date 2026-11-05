import { AppShell } from '@/components/shell/AppShell';
import { PageHeader } from '@/components/shell/PageHeader';
import { SectionCard } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/States';

export default function OverviewPage() {
  return (
    <AppShell title="Genel Bakış">
      <PageHeader
        title="Genel Bakış"
        description="Projelerinizdeki güncel saha operasyonlarını takip edin."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Proje ilerleme durumu" description="Gerçek proje verisi bağlandığında dolar">
          <EmptyState
            title="Henüz proje yok"
            description="Proje ve şantiye modülü Faz 03'te eklenecek. O fazdan sonra bu panelde proje ilerlemeleri görünecek."
          />
        </SectionCard>

        <SectionCard title="Son proje hareketleri" description="Günlük rapor ve görev akışları bağlandığında dolar">
          <EmptyState
            title="Henüz hareket yok"
            description="Günlük raporlar Faz 05'te, görevler Faz 04'te eklenecek. Kayıtlar oluştuktan sonra son hareketler burada listelenecek."
          />
        </SectionCard>
      </div>

      <p className="mt-4 text-xs leading-5 text-text-secondary">
        Not: Bu panel yalnızca gerçek API verisiyle dolar. Demo verisiyle doldurulan göstergeler
        kullanılmaz; boş durumlar ürün kararlarına göre tasarlanmıştır.
      </p>
    </AppShell>
  );
}
