# Mobil Geliştirme Kuralları
- Offline-first kayıt: yerel DB transaction + outbox.
- Ağ çağrısı başarısız olduğunda kullanıcı girdisini kaybetme.
- Token'ı SecureStore'da sakla; AsyncStorage'da token tutma.
- Kamera, galeri, konum izinlerini kullanım anında ve açıklamayla iste.
- Ekranlar küçük cihazlarda dikey kaydırılabilir ve tek elle kullanılabilir olsun.
- Liste virtualized olsun; büyük fotoğrafları tam çözünürlükte listeye yükleme.
- Klavye, safe area, platform geri tuşu ve uygulama arka plana geçiş senaryolarını test et.
