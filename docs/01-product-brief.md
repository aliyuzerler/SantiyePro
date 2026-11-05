# 01 — Ürün Tanımı ve İş Hedefi

## Ürün özeti
ŞantiyePro; inşaat firmalarının bir veya birden fazla şantiyedeki günlük operasyonlarını mobil cihazdan kaydetmesini, merkez ofisin web panelinden izlemesini sağlayan kurumsal iş yönetim yazılımıdır.

## Hedef müşteri
- Küçük ve orta ölçekli müteahhitlik firmaları
- Birden fazla şantiyesi bulunan inşaat şirketleri
- Ana yükleniciler ve taşeron ekipler
- Teknik ofis, saha şefi, depo ve muhasebe ekipleri

## Temel değer önerisi
- Şantiyede gerçekleşen işi günlük ve kanıtlanabilir biçimde kayıt altına almak.
- Personel devamı, malzeme hareketleri, görevler, giderler ve hakediş bilgisini tek yerde toplamak.
- Fotoğraf ve raporlarla merkez ofis ile saha arasındaki bilgi kaybını azaltmak.
- İnternetin zayıf olduğu sahalarda da kayıt alabilmek.
- Proje bazında ilerleme, maliyet ve sorumluluk görünürlüğü sağlamak.

## İlk sürüm modülleri
1. Firma/kurulum ayarları ve kullanıcılar
2. Projeler ve şantiyeler
3. Görev ve iş takibi
4. Günlük şantiye raporu
5. Fotoğraflı ilerleme ve ekler
6. Personel ve puantaj/katılım
7. Malzeme, depo ve stok hareketleri
8. Giderler ve hakediş kayıtları
9. Dashboard, raporlar ve dışa aktarma
10. Denetim kayıtları, yedekleme ve sistem ayarları

## Ticari model
- İlk sürümde uygulama içi abonelik ve ödeme sistemi bulunmaz.
- Her müşteri için ayrı kurulum ve ayrı veri alanı hedeflenir.
- Müşteriye tek seferlik süresiz kullanım lisansı / kurulum paketi satılabilir.
- Sunucu barındırma, kurulum, eğitim, bakım ve destek ayrı ticari hizmetler olabilir.
- İleride abonelik seçeneği düşünülürse ödeme, paket/limit ve lisans doğrulama modülleri ayrı bounded context olarak eklenir; bugünkü domain işlevlerine karıştırılmaz.

## Ürün kapsamı dışında (ilk sürüm)
- ERP / genel muhasebe yerine geçme
- E-fatura/e-defter entegrasyonu
- Banka ve ödeme kuruluşu entegrasyonu
- Bordro ve SGK bildirimi
- Yüz tanıma veya biyometrik personel takibi
- Sürekli arka plan GPS takibi
- Canlı araç filosu takibi
- Otomatik metraj çıkarımı için AI
- Çok müşterili ortak SaaS altyapısı
- Uygulama içi abonelik ve otomatik ödeme

## Başarı ölçütleri
- Bir kullanıcı zayıf bağlantıda günlük rapor, görev güncellemesi ve fotoğraf kaydı oluşturabilmeli.
- Ofis kullanıcısı proje bazında günlük raporları ve temel maliyet/stok özetlerini görebilmeli.
- Stok ve finansal hareketler denetlenebilir olmalı; eski hareketlerin izi kaybolmamalı.
- Müşteri kendi verisini dışa aktarabilmeli ve yedekten geri döndürebilmeli.
- Yeni müşteri kurulumu dokümante edilmiş Docker Compose adımlarıyla tekrarlanabilmeli.
