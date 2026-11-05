# 10 — Kurulum, Dağıtım ve Yedekleme

## Üretim kurulum modeli
Müşteri başına ayrı deployment önerilir. Örnek Docker Compose servisleri:
- `web`: Next.js panel
- `api`: NestJS API
- `db`: PostgreSQL (private network)
- `object-storage`: MinIO veya kurumun S3 uyumlu servisi
- `proxy`: Caddy/Nginx/Traefik ile TLS ve reverse proxy

Redis ilk sürüm için zorunlu değildir. İzleme/metrics servisi temel kurulumda opsiyoneldir.

## Kurulum ilkeleri
- Servisler ayrı Docker network içinde çalışmalı.
- PostgreSQL portu internete açılmamalı.
- Kalıcı volume'lar açıkça tanımlanmalı.
- Healthcheck ve restart policy bulunmalı.
- Secrets `.env` veya secret manager ile verilmeli; örnek dosya gerçek anahtar içermemeli.
- Migration deploy öncesi kontrollü çalıştırılmalı.
- İlk admin kullanıcı güvenli kurulum akışıyla oluşturulmalı.
- Müşterinin domain, SMTP, push notification ve storage ayarları yapılandırılabilir olmalı.

## Yedekleme
- PostgreSQL mantıksal yedeği günlük alınmalı; müşteri ihtiyacına göre sıklık ayarlanmalı.
- Nesne depolama dosyaları DB yedeğiyle uyumlu şekilde ayrıca yedeklenmeli.
- Yedekler production sunucusundan ayrı bir hedefe kopyalanmalı.
- Retention politikası belirlenmeli (ör. günlük/haftalık/aylık kopyalar; müşteriyle kararlaştırılır).
- Yedekleme başarı/failure logu ve son başarılı yedek zamanı görünmeli.
- Yalnızca backup dosyasının varlığı yeterli değildir; periyodik restore testi zorunludur.

## Geri yükleme prosedürü
1. Uygulamayı bakım moduna al.
2. DB ve object storage yedeklerinin aynı zaman penceresine ait olduğunu doğrula.
3. Önce test/staging ortamına restore et.
4. Migration uyumu ve dosya referanslarını doğrula.
5. Müşteri onayından sonra production restore yap.
6. Uygulamayı aç ve kritik iş akışlarını doğrula.

## Dağıtım teslim paketi
- Docker Compose ve image build dosyaları
- `.env.example`
- Kurulum/upgrade/rollback dokümanı
- DB migration'ları
- Backup/restore script'leri
- Health check
- Admin ilk kurulum akışı
- Uygulama sürüm numarası ve release notes
- Android/iOS build ve dağıtım yönergesi

## Sürümleme
Semantic Versioning önerilir: `MAJOR.MINOR.PATCH`. DB migration'ları geriye uyumluluk ve rollback stratejisi göz önünde bulundurularak hazırlanmalıdır.
