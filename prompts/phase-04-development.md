# Phase 04 — Görev Yönetimi

## Geliştirme promptu

`docs/02-scope-and-acceptance.md`, `docs/04-data-model.md`, `docs/06-roles-permissions.md` ve tasarım ekran dokümanlarını oku.

Task, TaskComment ve TaskStatusHistory modellerini ve migration'ları oluştur. Görev oluşturma, düzenleme, atama, öncelik, termin, checklist, yorum, ek dosya referansı ve durum geçmişini uygula.

Durum akışı: `TODO`, `IN_PROGRESS`, `BLOCKED`, `DONE`, `CANCELLED`. Geçersiz durum geçişlerini servis katmanında engelle. Kullanıcı yalnızca yetkili projede görev görebilmeli. Atanan kullanıcıya uygulama içi bildirim altyapısı için event üret; gerçek push sağlayıcısı sonraki fazda ele alınabilir.

Web'de filtrelenebilir tablo ve detay drawer; mobilde Bana Atananlar/Proje Görevleri listesi ve görev detay ekranı. Termin geçmişse metin/ikonla gecikme belirt. Görev durum değişiklikleri audit/history üretmeli.
