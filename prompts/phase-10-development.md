# Phase 10 — Raporlama, Audit, Dışa Aktarma ve Backup

## Geliştirme promptu

`docs/08-performance-rules.md`, `docs/10-deployment-backup.md`, `docs/11-testing-strategy.md`, `docs/12-release-checklist.md` ve web ekran tasarımını oku.

Aşağıdaki raporları gerçek DB verisinden üret:
- Proje genel görünümü
- Günlük rapor tarih/proje özeti
- Puantaj/katılım
- Stok bakiyesi ve hareketleri
- Gider özeti
- Hakediş dönemi özeti
- Görev durum/termin raporu

Filtreler: tarih aralığı, proje/şantiye, durum ve yetki kapsamı. PDF Türkçe karakter desteklemeli; XLSX gerçek hücre tiplerini kullanmalı. Büyük veri için server-side pagination veya kontrollü background job yaklaşımı. Dışa aktarma audit log üretmeli.

Audit log ekranı yalnızca yetkili kullanıcıya açılır; entity/action/actor/date filtresi ve önce/sonra görünümü sağlar, hassas alanları maskeler.

Backup/restore script ve Docker Compose production profili oluştur. DB ve object storage yedeğini ayrı ele al; restore dokümanını test ederek doğrula. Backup durumunu admin ayarlarında göster. Uygulama içinden tehlikeli ve yetkisiz restore işlemi başlatma; kontrollü operasyon script'i kullan.
