# 07 — Güvenlik Kuralları ve Kontrol Listesi

## Kimlik ve oturum
- Parolaları Argon2id veya güncel güvenli parola hash algoritmasıyla sakla; düz metin ve reversible encryption yasak.
- Login denemelerine rate limit ve artan gecikme uygula; kullanıcı var/yok bilgisini hata mesajıyla sızdırma.
- Refresh token rotasyonu, token reuse tespiti ve logout/revoke desteği sağla.
- Web oturumunda HttpOnly/Secure cookie; CSRF koruması ve doğru SameSite politikası kullan.
- Parola sıfırlama token'ı tek kullanımlık, süreli ve hash'lenmiş saklanmalı.

## Yetkilendirme
- Deny-by-default.
- RBAC + proje üyeliği/scope kontrolü.
- Her endpoint için permission ve resource ownership testi.
- Dosya indirme ve rapor dışa aktarmada tekrar yetki kontrolü.

## Veri ve ağ
- Üretimde HTTPS zorunlu; TLS sonlandırma proxy yapılandırması belgelenmeli.
- SQL injection için Prisma parametreli sorgular; raw SQL gerekiyorsa güvenli parametreleme.
- XSS için çıktı encoding, güvenli rich-text yaklaşımı ve Content Security Policy.
- CORS yalnızca tanımlı istemci origin'lerine açık olmalı; wildcard + credentials kullanma.
- Hassas alanlar gereksiz loglanmamalı; loglarda token/parola bulunmamalı.
- Secrets repoya, build artifact'larına veya mobil bundle'a gömülmemeli.

## Dosya güvenliği
- İzin verilen MIME ve boyut listesi tanımla; yalnızca dosya uzantısına güvenme.
- Dosya adını sunucu üretmeli; path traversal engellenmeli.
- Özel medya public bucket'ta tutulmamalı.
- İmzalı indirme bağlantıları kısa ömürlü olmalı.
- Görsel yüklemede EXIF metadata (özellikle GPS) politikası açıkça belirlenmeli; varsayılan olarak kullanıcıya konum sızdırma.
- SVG ve çalıştırılabilir dosya türleri varsayılan upload listesinden çıkarılmalı.

## Mobil güvenlik
- Token için Expo SecureStore veya platform güvenli depolaması kullan.
- SQLite içinde parola veya refresh token tutma.
- Uygulama loglarında kişisel veri ve tam dosya yolu bulunmasın.
- İzinler ihtiyaç anında sorulsun; sürekli konum izni istenmesin.
- Cihazda saklanan yerel DB için işletim sistemi koruması ve uygulama sandbox'ı kullan; gerekçesiz özel kriptografi yazma.

## Kritik iş kayıtları
- Stok, gider, hakediş, puantaj onayı, rol değişikliği ve rapor onayı audit log üretir.
- Onaylı/işlenmiş finansal kayıtlar fiziksel silinmez; iptal veya ters kayıt kullanılır.
- Değişiklik öncesi/sonrası alanları hassas veri maskelemesiyle logla.
- Eşzamanlı güncellemelerde optimistic locking/version kontrolü uygula.

## Operasyonel güvenlik
- Bağımlılık taraması ve secret scanning CI'da çalışmalı.
- Production DB internete doğrudan açılmamalı.
- Varsayılan admin parolası ilk kurulumda değiştirilmek zorunda olmalı; örnek credential production'da kabul edilmemeli.
- Admin işlemleri için gerekirse MFA sonraki güvenlik iyileştirmesi olarak planlanabilir; MVP'de parola politikası ve güvenli oturum zorunludur.
- Backup dosyaları erişim kontrollü ve mümkünse şifreli depolanmalı.
- Güvenlik olayı müdahale ve parola/token iptal prosedürü yazılmalı.

## KVKK ve çalışan verisi
Personel adı, devam kaydı, fotoğraf ve konum gibi veriler kişisel veri içerebilir. Üründe amaç sınırlılığı, rol bazlı erişim, saklama süresi ayarı, kayıt dışa aktarma/silme taleplerinin yönetilebilmesi ve aydınlatma metni ekleme alanları tasarlanmalıdır. Hukuki uyum, müşteri kurumun süreçleri ve uzman danışmanlığıyla ayrıca doğrulanmalıdır. Biyometrik yüz tanıma ilk sürüm kapsamı dışındadır.
