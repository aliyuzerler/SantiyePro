# Web Yönetim Paneli — Ekran Spesifikasyonu

## Ana iskelet
- Sol sidebar: 248 px, lacivert yüzey. Logo/ürün adı üstte.
- Üst bar: sayfa başlığı/breadcrumb, proje seçimi, bildirim, kullanıcı menüsü.
- İçerik: açık gri arka plan, beyaz kartlar, 24 px grid.
- Sayfa başlığının sağında sayfaya özgü birincil aksiyon.

## Menü
- Genel Bakış
- Projeler
- Görevler
- Günlük Raporlar
- Personel & Puantaj
- Depo & Malzemeler
- Giderler
- Hakedişler
- Raporlar
- Kullanıcılar & Yetkiler
- Ayarlar

Menü öğeleri izinlere göre görünür. Bu, backend yetkisinin yerine geçmez.

## Dashboard
- KPI kartları: aktif proje, bugün raporlanan şantiye, açık görev, bekleyen onay, kritik stok uyarısı.
- Proje bazında ilerleme/iş durumu (yüzde yalnızca gerçek veri varsa).
- Son günlük raporlar.
- Yaklaşan görev terminleri.
- Son gider/hakediş hareketleri.
- Hata/boş durumları için anlamlı açıklama; demo sayılarla gerçekmüş gibi gösterim yasak.

## Proje yönetimi
- Liste: kod, proje adı, sorumlu, başlangıç/bitiş, durum, son aktivite.
- Filtre: durum, sorumlu, tarih.
- Detay sekmeleri: Genel, Görevler, Raporlar, Personel, Stok, Gider, Hakediş, Dosyalar.
- Proje oluştur/düzenle drawer veya sayfası; alanlar gruplu ve doğrulamalı.

## Operasyon ekranları
- Görevler: filtrelenebilir tablo + detay drawer.
- Günlük raporlar: tarih/proje/şantiye/durum filtreleri; rapor detayında fotoğraf galerisi ve revizyon geçmişi.
- Puantaj: tarih seçici, satır bazlı düzenleme, toplu işlem onayı, XLSX/PDF dışa aktarma.
- Stok: malzeme listesi, depo filtresi, hareket geçmişi, yeni hareket modalı. Hareket geçmişi kronolojik ve değiştirilemez görünür.
- Gider: durum sekmeleri, kategori/tarih/proje filtreleri, fiş önizleme.
- Hakediş: dönem seçimi, sözleşme kalem tablosu, miktar/fiyat/önceki/cari/toplam, kesinti ve net tutar özeti. Kaydetmeden önce hesaplama önizlemesi.

## Tablo standardı
- Server-side pagination, sort, filter.
- Kolon başlıkları kısa ve anlaşılır.
- Sayı ve para değerleri sağa hizalı.
- Durum pill'i + ikon/metin.
- Satır aksiyonları üç nokta menüsünde; en sık aksiyon ayrı buton olabilir.
- Empty state, loading skeleton ve error retry.
- Mobil breakpoint'te tablo sıkıştırılmasın; kart veya yatay kaydırma tasarlansın.

## Form standardı
- Label üstte; zorunlu alan yıldızla.
- Alan hatası input altında; form genel hatası üstte.
- Kaydet/iptal aksiyonları sabit ve görünür.
- Silme/iptal işlemi açıklama isteyebilir.
- Kaydedilmemiş değişiklikte sayfadan çıkış uyarısı.

## Rapor ve dışa aktarma
- Filtrelerin rapor çıktısına yansıması gerekir.
- Tarih aralığı ve proje başlığı çıktıda bulunmalı.
- PDF çıktısı Türkçe karakterleri destekleyen fontla hazırlanmalı.
- Excel çıktısında veri hücreleri gerçek sayı/tarih tipinde olmalı; yalnızca görsel tablo olmamalı.
