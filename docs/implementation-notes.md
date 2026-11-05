# Uygulama Notları ve Açık Kararlar

## Başlangıç varsayımları
- Mobil hedef: Android ve iOS; saha pilotu Android'de başlatılabilir.
- Yönetim paneli: masaüstü öncelikli responsive web.
- Dil: ilk sürüm Türkçe; i18n altyapısı metinleri merkezi tutacak şekilde hazırlanabilir.
- Para birimi: kurulum bazında seçilebilir; varsayılan TRY sadece kurulum varsayılanıdır.
- Saat dilimi: kurulum bazında seçilebilir; Türkiye kurulumlarında Europe/Istanbul.
- Tek kurulum = tek müşteri/kuruluş.

## Geliştirmeye başlamadan önce ZCode'un doğrulaması gereken kararlar
- iOS dağıtımı App Store mu, müşteri kurum içi dağıtımı mı olacak?
- Fotoğraf saklama limiti ve müşteri sunucu disk kapasitesi nasıl belirlenecek?
- Push notification sağlayıcısı hangi müşteri dağıtım modelinde kullanılacak?
- Hakediş formatı müşterinin sözleşme/işveren şablonuna göre ne kadar özelleşecek?
- Personel vardiya ve puantaj kuralları firma bazında nasıl yapılandırılacak?

Bu sorular ilk iskeleti engellemez; ilgili modüllere gelindiğinde yapılandırılabilir tasarlanmalıdır.

## Ürün kararları değişirse
Kararları doğrudan kod içinde örtük biçimde değiştirme. Önce ilgili ADR'yi güncelle, migration/etki analizi yap ve test planını yenile.
