# 08 — Performans, Ölçeklenebilirlik ve Kararlılık

## Mobil
- Ana dashboard ilk açılışta yalnızca gerekli özetleri yüklemeli; ağır raporlar talep üzerine çağrılmalı.
- Listelerde sayfalama veya cursor pagination kullan; büyük veri setini tek seferde çekme.
- Görseller thumbnail + orijinal şeklinde saklanmalı; listelerde thumbnail gösterilmeli.
- Fotoğraf yükleme öncesi makul çözünürlüğe küçültme/sıkıştırma uygulanmalı; orijinal gerekiyorsa ayrıca korunmalı.
- Offline queue sınırlı batch'lerle gönderilmeli; exponential backoff + jitter kullanılmalı.
- Ekranlarda gereksiz yeniden render engellenmeli; sanal liste kullan.

## Web
- Büyük tablolar server-side filtreleme/sıralama/sayfalama kullanmalı.
- Dashboard'da ağır hesaplar istek başına tekrar yapılmamalı; uygun indeks ve cache stratejisi belirlenmeli.
- Büyük rapor/PDF üretimi arka plan işi olabilir; ilk sürümde makul veri hacmi sınırları belgelenmeli.

## API ve veritabanı
- N+1 sorgu problemlerini önle; ilişkileri ihtiyaç kadar yükle.
- Sık filtrelenen ve sıralanan sütunlara ölçümle indeks ekle.
- Transaction süresini kısa tut; dosya yüklemesini DB transaction'ı içinde bekletme.
- Connection pool ve timeout değerlerini deployment ortamına göre yapılandır.
- Sağlık uçları (`/health/live`, `/health/ready`) oluştur.
- Ağır raporlarda EXPLAIN/ANALYZE ile sorgu planını incele.

## Hedef performans bütçeleri (başlangıç hedefi)
- Standart API okuma uçları: p95 < 500 ms (müşteri sunucusu ve veri hacmi uygunken).
- Basit API yazma uçları: p95 < 800 ms (dosya yükleme hariç).
- Web ilk kullanılabilir ekran: orta seviye masaüstü bağlantısında mümkün olduğunca < 3 sn.
- Mobil ekran geçişleri: tipik durumda < 300 ms algılanan tepki.
- Listelerde ilk anlamlı içerik: < 1.5 sn hedefi.

Bu hedefler ölçüm hedefidir, her donanımda garanti değildir. CI performans testleri sabit ve açıklanmış test verisiyle yapılmalıdır.

## Kararlılık
- Tüm ağ isteklerinde timeout ve kontrollü retry politikası.
- POST/finansal işlemler idempotency olmadan otomatik tekrar edilmemeli.
- Hata takibi için trace ID ve yapılandırılabilir log seviyesi.
- Mobil uygulama çökme/hata durumunda kullanıcı veri kaybını azaltacak yerel kayıt yaklaşımı.
- Bellek sızıntısı, büyük görsel listesi ve uzun açık oturum senaryoları test edilmeli.
