# Phase 07 — Depo, Malzeme ve Stok Hareketleri

## Geliştirme promptu

`docs/04-data-model.md`, `docs/05-api-contracts.md`, `docs/06-roles-permissions.md`, `docs/07-security-rules.md`, `docs/08-performance-rules.md` ve `docs/09-offline-sync.md` dosyalarını oku.

Warehouse, Material, StockMovement ve gerekli balance/read model yapılarını kur. Malzeme katalog ve depo ekranları; stok giriş, çıkış, transfer, iade, düzeltme/ters kayıt akışlarını web ve mobilde oluştur.

Zorunlu kurallar:
- Hareket append-only; eski hareket doğrudan düzenlenmez/silinmez.
- Transfer kaynak çıkış + hedef giriş olarak tek DB transaction.
- Eşzamanlı stok çıkışında negatif stok oluşmasına izin verme; transaction/row lock veya güvenilir atomik strateji uygula.
- Birim uyumu doğrulansın.
- Stok miktarı decimal hassasiyetli; yuvarlama politikası açık.
- Offline cihazdaki son bilinen stok uyarı olarak gösterilir; kesin kabul sunucu doğrulamasına bağlıdır.
- `clientMutationId` duplicate hareketi engeller.
- Her hareket aktör, zaman, proje/depo, açıklama ve gerektiğinde belge referansı taşır.

Hareket geçmişi filtrelenebilir ve denetlenebilir olmalı. Stok kartında mevcut bakiye yanında son güncelleme zamanı görünmeli.
