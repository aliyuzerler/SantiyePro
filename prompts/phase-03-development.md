# Phase 03 — Projeler ve Şantiyeler

## Geliştirme promptu

`docs/02-scope-and-acceptance.md`, `docs/04-data-model.md`, `docs/06-roles-permissions.md` ve `design/02-mobile-screen-spec.md` / `design/03-web-dashboard-spec.md` dosyalarını oku.

Project, Site ve ProjectMember modellerini migration ile oluştur. Proje oluşturma/düzenleme, durum yönetimi, sorumlu atama, proje üye yönetimi, proje listesi ve detay ekranlarını hem web hem mobilde uygula.

Kurallar:
- Proje kodu kurulum içinde benzersiz olmalı.
- Kullanıcı yalnızca erişim kapsamındaki projeleri görebilmeli.
- Proje pasife alınırken bağlı kayıtları silme.
- Tarihler timezone-safe saklanmalı.
- Liste API'sinde pagination, filtre ve arama zorunlu.
- Proje silme yerine archive/soft-delete kullan.
- Proje değiştiricide yanlış projeye kayıt açmayı önlemek için aktif proje bağlamı görünür olsun.
- Web'de tablo; mobilde proje kartı ve sekmeli detay.
- API OpenAPI dokümantasyonunu güncelle.

Test seed verileri sentetik olsun; dashboard'a sabit sahte proje sayısı yazma.
