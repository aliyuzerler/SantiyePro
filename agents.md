# ZCode Agent Instructions — SantiyePro

## Görev
Bu depo, müşterilere tek seferlik kullanım lisansıyla satılacak bir şantiye yönetim ürünüdür. Ürün; mobil saha uygulaması, web yönetim paneli ve API'den oluşur. Öncelik güvenilir saha operasyonu, veri tutarlılığı, kurumsal arayüz ve kurulabilirliktir.

## Her zaman okunacak kaynaklar
- `docs/01-product-brief.md`
- `docs/02-scope-and-acceptance.md`
- `docs/03-architecture.md`
- `docs/06-roles-permissions.md`
- `docs/07-security-rules.md`
- `docs/08-performance-rules.md`
- `docs/09-offline-sync.md`
- `design/01-design-system.md`
- `design/02-mobile-screen-spec.md`
- `design/03-web-dashboard-spec.md`
- İlgili faz promptu ve test promptu

## Çalışma protokolü
1. İşe başlamadan önce mevcut depo yapısını, package manager'ı, kod standartlarını ve çalışan testleri incele.
2. Mevcut çalışan özellikleri bozmadan ilerle. Dosyaları topluca yeniden yazma; gerekçesiz teknoloji değişikliği yapma.
3. Yalnızca istenen fazı uygula. Sonraki fazların kapsamını erkenden kodlama.
4. Uygulama öncesi kısa bir görev planı ve etkilenecek dosyaları belirt; sonra gerçek kodu yaz.
5. Placeholder ekran, sahte API, sabit demo verisi veya yalnızca görsel çalışan buton bırakma. Geliştirilmemiş özellikleri açıkça `TODO` olarak raporla; üretim akışında sahte başarı gösterme.
6. Her işte yükleme, boş, hata, başarı, çevrimdışı ve yetkisiz durumlarını ele al.
7. API doğrulamasını sunucuda yap. İstemci doğrulaması yalnızca UX içindir.
8. Para, stok, hakediş ve puantaj gibi kritik işlemleri transaction ve audit log ile yönet.
9. Mobilde bağlantı yokken kayıt oluşturmayı destekle; senkronizasyon durumunu kullanıcıya görünür kıl.
10. Kişisel veri, fotoğraf ve konum erişimini en az ayrıcalık ilkesiyle ele al. Gereksiz izin isteme.
11. Her faz sonunda ilgili test promptunu çalıştır, sonuçları raporla ve başarısız testleri düzelt.
12. Yeni bağımlılık eklemeden önce gerekliliğini, bakım durumunu ve lisansını değerlendir.

## Mimari ilkeler
- Modüler monolit backend; ilk sürümde mikroservis yok.
- Tek müşteri / tek kurulum / tek veritabanı varsayımı.
- Mobil uygulama offline-first; server source of truth, yerel SQLite çevrimdışı çalışma alanı.
- REST API ve OpenAPI sözleşmesi.
- PostgreSQL + Prisma migration.
- Dosyalar veritabanında binary olarak tutulmaz; metadata DB'de, içerik nesne depolamada tutulur.
- Kimlik ve yetki kontrolü backend'de zorunludur; UI'da gizlemek güvenlik kontrolü değildir.

## Kod kalitesi
- TypeScript strict mode.
- `any` kullanımından kaçın; gerekiyorsa gerekçesini yaz.
- API DTO/schema validasyonu, tip güvenliği ve merkezi hata formatı.
- Fonksiyonlar tek sorumluluklu, isimler iş alanını açıkça anlatır.
- İş kuralları UI bileşenlerine gömülmez; domain/service katmanında bulunur.
- Para hesaplarında floating point kullanma; decimal/numeric veya kuruş gibi tam sayı birimi kullan.
- Tarihleri UTC sakla, arayüzde proje/kurum saat dilimine göre göster.
- Loglarda parola, token, kişisel hassas veri veya dosya içeriği tutma.

## UI/UX zorunlulukları
- `design/` altındaki token ve ekran kurallarına uy.
- Kurumsal, sade, yoğun veri ekranlarında okunabilir tasarım kullan.
- Mobilde temel etkileşim alanı en az 44x44 dp; mümkünse 48 dp.
- Kritik işlemde onay, geri alma/iptal politikası ve işlem sonucu görünür olmalı.
- Formlarda alan etiketi, örnek/yardım metni ve anlaşılır doğrulama hatası bulunmalı.
- Renk tek başına durum anlatmamalı; ikon/metin de kullanılmalı.
- Geniş ekran web panelinde tablo ve filtreler; mobilde kart/özet ve kolay kayıt akışı tercih edilir.

## Test kapısı
Bir faz tamamlandı demek için:
- İlgili otomatik testler geçmeli.
- Typecheck, lint ve build başarılı olmalı.
- Yetkisiz erişim ve hata senaryoları test edilmeli.
- Değişen API veya ekranların regresyonu kontrol edilmeli.
- Test edilemeyen alanlar ve manuel doğrulama adımları açıkça yazılmalı.

## Yasaklar
- Abonelik, ödeme, otomatik yenileme veya online lisans kontrolü ekleme.
- İlk sürümde multi-tenant SaaS katmanı oluşturma.
- Şifreleri düz metin veya geri çözülebilir biçimde saklama.
- Kullanıcıdan habersiz sürekli GPS takibi yapma.
- Kamera/fotoğraf/konum izni olmadan bu verileri toplamaya çalışma.
- Finansal veya stok hareketlerini sessizce üzerine yazma/silme.
- Güvenlik kontrollerini yalnızca frontend'de uygulama.
