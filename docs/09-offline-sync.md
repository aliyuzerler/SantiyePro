# 09 — Offline-First ve Senkronizasyon Tasarımı

## Hedef
Şantiyede internet olmadığında kullanıcı günlük rapor, görev güncellemesi, puantaj taslağı ve malzeme hareketi taslağı oluşturabilmeli. Uygulama çevrimdışı kayıtları yerel SQLite'a yazmalı; bağlantı geldiğinde kontrollü biçimde sunucuya aktarmalıdır.

## Yerel veri modeli
- `local_entities`: sunucudan çekilen/yerel oluşturulan kayıtların özeti ve `serverId` eşlemesi.
- `outbox`: `clientMutationId`, `entityType`, `operation`, `payload`, `createdAt`, `attemptCount`, `status`, `lastError`.
- `media_queue`: yerel dosya URI, checksum, hedef ilişki, upload status.
- `sync_cursor`: son başarılı pull cursor'ı.

## Sync akışı
1. Kullanıcı eylemi önce yerel DB transaction'ına yazılır.
2. Aynı transaction içinde outbox kaydı oluşturulur.
3. UI kaydın `Cihazda bekliyor` durumunu gösterir.
4. İnternet geldiğinde outbox sırayla veya küçük batch'lerle gönderilir.
5. API `clientMutationId` üzerinden idempotency sağlar.
6. Başarılı yanıt server ID ve güncel versiyonu yerel kayda işler.
7. Başarısız işlem geçici/kalıcı hata olarak ayrılır; geçici hata backoff ile tekrar denenir.
8. Uygulama sunucudan delta değişiklikleri cursor ile çeker.

## Çakışma politikası
- Stok hareketi, gider ve hakediş gibi kritik işlemler append-only/işlem bazlıdır; otomatik üzerine yazma yapılmaz.
- Günlük rapor taslağında aynı kayıt iki cihazda değiştirilmişse versiyon çakışması gösterilir ve kullanıcıya karşılaştırma/yeniden uygulama seçeneği verilir.
- Görev açıklaması gibi düşük riskli alanlarda server version kontrolü ve kullanıcıya anlaşılır çakışma mesajı kullanılır.
- Silme, sunucudan gelen tombstone işaretleriyle senkronize edilir.
- Saat farkı tek başına veri sıralama kaynağı değildir; server sequence/version/cursor esas alınır.

## Fotoğraf senkronizasyonu
- Önce form/rapor metadata'sı yerel kaydedilir.
- Fotoğraf kuyruğa alınır; bağlantı gelince upload URL istenir ve dosya yüklenir.
- Upload tamamlanmadan kayıt `Tam senkronize` gösterilmez.
- Büyük dosyalarda yeniden başlatılabilir upload sonraki iyileştirme olarak planlanabilir.

## Kullanıcıya gösterilecek durumlar
- Çevrimdışı — veriler bu cihazda saklanıyor.
- Senkronizasyon bekliyor — X kayıt.
- Senkronize ediliyor.
- Güncel — son senkronizasyon zamanı.
- Çakışma/hata — çözüm gerektiren kayıt sayısı ve açıklama.

## Test senaryoları
- Kayıt oluştururken internet kesilmesi.
- Uygulama force-close ve yeniden açılış.
- Aynı mutation'ın üç kez gönderilmesi.
- İki cihazda aynı raporun güncellenmesi.
- Fotoğraf yükleme ortasında bağlantı kaybı.
- Sunucu 5xx, 401 ve validation 4xx yanıtları.
- Cihaz saati yanlış olduğunda kayıt sırası.
