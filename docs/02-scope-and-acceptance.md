# 02 — Kapsam, Kullanıcı Akışları ve Kabul Kriterleri

## Kullanıcı tipleri
- Firma yöneticisi: tüm projeler, kullanıcılar ve sistem ayarları.
- Proje yöneticisi: atandığı projelerde operasyon ve raporlar.
- Şantiye şefi: günlük rapor, görev, personel ve saha durumları.
- Teknik ofis: metraj, hakediş kalemleri, proje ilerlemesi ve belgeler.
- Depo sorumlusu: malzeme, depo ve stok hareketleri.
- Muhasebe/finans: gider, hakediş ve maliyet kayıtları.
- Saha personeli/taşeron yetkilisi: kendisine verilen görevleri ve izin verilen kayıtları görüntüleme/güncelleme.

## Ana akışlar

### Proje oluşturma
Firma yöneticisi proje adı, müşteri/işveren, proje kodu, lokasyon (adres/metin), başlangıç-bitiş tarihleri, sözleşme tutarı (opsiyonel), sorumlu kişi ve durum bilgilerini girer. Proje altında bir veya daha fazla şantiye/alan oluşturabilir.

### Günlük rapor
Şantiye şefi proje ve tarihi seçer; hava durumu, çalışan ekip, yapılan işler, kullanılan ekipman, gecikme/engel, iş güvenliği notu ve ertesi gün planını girer. Fotoğraf ve dosya ekler. Taslak kaydedebilir, gönderime alabilir. Gönderilmiş rapor düzenlenirse revizyon kaydı oluşur.

### Personel devamı
Yetkili kullanıcı vardiya/tarih seçerek personeli listeden işaretler; tam gün, yarım gün, izinli, raporlu, gelmedi gibi kurumca yapılandırılabilir durumları seçer. Giriş/çıkış saati ve not eklenebilir. GPS konumu yalnızca açıkça etkinleştirilmiş ve izin verilmiş tekil işlem anında alınabilir; varsayılan kapalıdır.

### Malzeme hareketi
Depo sorumlusu giriş, çıkış, transfer, iade veya düzeltme hareketi oluşturur. Her harekette proje/depo, malzeme, miktar, birim, tarih, belge/fotoğraf ve açıklama yer alabilir. Stok hareketleri geçmişten silinmez; düzeltme ters kayıt ile yapılır.

### Görev yönetimi
Görev; proje, sorumlu kullanıcı/ekip, öncelik, son tarih, açıklama, kontrol listesi, durum ve eklerle oluşturulur. Durum değişiklikleri geçmişte tutulur.

### Gider ve hakediş
Gider; kategori, proje, tedarikçi/ödeyen, tarih, tutar, KDV alanı (opsiyonel), belge eki ve onay durumu içerir. Hakediş dönemi; sözleşme kalemi, birim, sözleşme miktarı, birim fiyat, önceki/toplam/gerçekleşen miktar, kesinti ve açıklama üzerinden hesaplanır. Formüller teknik ofis tarafından doğrulanabilir ve PDF çıktısı alınabilir.

## Fonksiyonel kabul kriterleri
- Proje olmadan proje ilişkili kayıt oluşturulamaz.
- Kullanıcı yalnızca yetkili olduğu projeleri görür.
- Her kritik kayıt `createdBy`, `createdAt`, `updatedAt`, gerekiyorsa `approvedBy` ve revizyon/audit bilgisi taşır.
- Silme işlemi kritik kayıtlarda soft-delete veya ters kayıt yaklaşımıyla yapılır.
- Liste ekranlarında arama, filtre, sıralama, sayfalama ve boş durum bulunur.
- Fotoğraf yüklemede dosya türü/boyutu kontrolü ve küçük önizleme bulunur.
- Çevrimdışı oluşturulan kayıtlar bağlantı geldiğinde tekrar gönderilebilir ve çift kayıt oluşmaz.
- Dışa aktarma işlemleri yetkiye tabidir ve işlem kaydı oluşturur.

## İlk sürümde raporlar
- Proje genel bakış
- Günlük rapor listesi ve tarih aralığı raporu
- Personel devam/puantaj özeti
- Malzeme stok ve hareket raporu
- Proje gider özeti
- Hakediş dönem özeti
- Görev durum/termin raporu

## İlk sürüm dışında bırakılacak ayrıntılar
İşveren portalı, taşeronların kendi tenant'ı, e-imza, gelişmiş metraj/BIM, muhasebe entegrasyonu ve yapay zekâ tahminleri sonraki sürüm olarak ele alınır.
