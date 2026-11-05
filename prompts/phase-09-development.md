# Phase 09 — Offline-First Sync

## Geliştirme promptu

`docs/09-offline-sync.md`, `docs/04-data-model.md`, `docs/05-api-contracts.md`, `docs/07-security-rules.md` ve mobil kuralları oku.

Mobil SQLite schema, repository katmanı, outbox, media queue, sync cursor, connectivity observer ve sync status UI'sını gerçek şekilde uygula. Öncelikli çevrimdışı akışlar: görev güncelleme/yorum, günlük rapor taslağı ve puantaj kaydı. Stok/gider gibi kritik hareketlerde mutation idempotency ve server validation zorunludur; offline kayıt “sunucu onayı bekliyor” olarak gösterilmelidir.

API'de `/sync/push` ve `/sync/pull` uçlarını tasarla:
- Her mutation `clientMutationId` ile idempotent.
- Push sonucu her mutation için accepted/rejected/conflict ve açıklama içerir.
- Pull cursor/sequence ile delta getirir.
- Yetkisiz veya artık erişilemeyen proje verisi cihaza gönderilmez.
- Conflict otomatik last-write-wins ile kritik kayıt üzerine yazmaz.
- Geçici ağ/5xx hatalarında exponential backoff + jitter.
- 401'de güvenli refresh; başarısızsa kullanıcı login'e yönlendirilir ve outbox kaybolmaz.
- App kapanıp açılsa da outbox devam eder.

Sync queue ekranı: bekleyen, gönderilen, hata/çakışma ve son başarılı senkron zamanı. Kullanıcı hata kaydını görebilmeli ve güvenli retry yapabilmeli.
