# Mobil Uygulama — Ekran ve Akış Spesifikasyonu

## Navigasyon
Alt navigasyon 5 ana giriş:
1. Ana Sayfa
2. Projeler
3. Ortada belirgin `+ Kayıt` aksiyonu
4. Görevler
5. Profil / Daha Fazla

`+ Kayıt` menüsü: Günlük rapor, Puantaj, Malzeme hareketi, Gider, Fotoğraf/ilerleme.

## 1. Giriş ve hesap
- Logo, e-posta, parola, parolayı göster, giriş butonu.
- Sunucu adresi ilk kurulumda yönetilen konfigürasyonla belirlenir; kullanıcıya teknik URL sorulması gerekiyorsa açıklamalı kurulum ekranı kullan.
- Hatalı girişte genel ve güvenli mesaj; bağlantı yoksa ayrı durum.

## 2. Ana sayfa
- Üstte firma/proje seçici ve çevrimdışı/sync göstergesi.
- Merhaba + kullanıcının rolü.
- Atandığım aktif proje kartları.
- Bugünün görevleri, bekleyen raporlar, puantaj özeti, stok uyarıları.
- Hızlı işlem kısayolları.
- İçerik role göre filtrelenir; yetkisiz modül kartı gösterilmez.

## 3. Proje listesi ve proje detayı
- Arama, durum filtresi, favori/son açılan.
- Kartta proje adı, kodu, durum, tarih aralığı, sorumlu.
- Detayda özet, görevler, günlük raporlar, personel, stok, gider/hakediş sekmeleri (izinli modüller).
- Proje/şantiye değiştiğinde önceki proje bağlamı yanlışlıkla kullanılmamalı.

## 4. Günlük rapor oluşturma
Bölümlü form:
- Proje/şantiye ve rapor tarihi
- Hava durumu (manuel; dış servis entegrasyonu zorunlu değil)
- Yapılan işler
- Çalışan ekip/personel özeti
- Ekipman ve makine
- Sorun/gecikme ve iş güvenliği notu
- Ertesi gün planı
- Fotoğraf ve belge ekleri
- Taslak kaydet / Gönder

Uzun formda otomatik taslak kaydı, bölüm ilerleme göstergesi ve gönderim öncesi özet bulunmalı. Çevrimdışı kayıt açıkça etiketlenmeli.

## 5. Görevler
- Bana atananlar / Projedekiler filtreleri.
- Görev kartı: başlık, proje, öncelik, termin, durum.
- Detay: açıklama, checklist, yorum, ek, durum güncelleme.
- Yetki yoksa atama/düzenleme aksiyonu gösterilmez.

## 6. Puantaj
- Tarih ve proje/şantiye seçimi.
- Personel arama ve hızlı durum seçimi.
- Toplu işaretleme: hepsi geldi / seçilenleri izinli vb. yalnızca açık onayla.
- Giriş/çıkış ve not alanı.
- Kaydetmeden önce toplam kişi ve durum özeti.

## 7. Malzeme
- Malzeme arama, depo seçimi, anlık stok özeti.
- Giriş/çıkış/transfer/iade/düzeltme ayrımı belirgin.
- Miktar + birim + açıklama + belge/fotoğraf.
- Stok yetersizse net hata; offline işlemde son bilinen stok bilgisi uyarısı ve sunucu onay bekleme durumu.

## 8. Gider ve hakediş
Mobilde hızlı gider girişi ve hakediş özeti öncelikli. Karmaşık hakediş kalemi düzenleme web panelde daha rahat yapılabilir. Tutar, para birimi ve onay durumu net gösterilmeli.

## 9. Profil / ayarlar
- Kişisel profil, parola değiştir, bildirim tercihleri.
- Senkronizasyon kuyruğu ve başarısız kayıtlar.
- Uygulama sürümü, sunucu bağlantı durumu.
- Çıkış.

## Mobil UX kuralları
- Her ana akışta 1–2 birincil aksiyon; fazla buton menüye alınır.
- Kamera ve dosya izinleri ihtiyaç anında istenir.
- Fotoğraf seçimi sonrasında thumbnail, dosya boyutu ve kaldırma aksiyonu gösterilir.
- Form klavyesi alan tipine göre açılır; sayısal alanlar numeric keyboard kullanır.
- Kaydetme sırasında tekrar tıklama engellenir.
- Kritik aksiyonlarda onay modalı ve net sonuç mesajı bulunur.
- Sinyal yokken uygulama hata vermek yerine offline moduna geçer.
