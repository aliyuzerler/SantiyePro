# Phase 06 — Personel ve Puantaj

## Geliştirme promptu

`docs/04-data-model.md`, `docs/06-roles-permissions.md`, `docs/07-security-rules.md` ve mobil/web ekran spesifikasyonlarını oku.

Personnel ve AttendanceRecord modellerini kur. Personel listesi, aktif/pasif durum, iş unvanı ve taşeron/işveren bilgisi; puantajda tarih, proje/şantiye, vardiya anahtarı, durum, giriş-çıkış, çalışılan dakika ve not alanlarını uygula.

Varsayılan devam durumları: `PRESENT`, `HALF_DAY`, `ABSENT`, `LEAVE`, `SICK`, `HOLIDAY`; kurum ayarıyla genişletilebilir. Toplu işaretleme önizleme ve onay gerektirir. Aynı personel/proje/tarih/vardiya duplicate kaydı DB unique constraint ve servis kontrolüyle engelle.

Web'de personel yönetimi ve puantaj tablosu; mobilde hızlı personel arama ve satır bazlı işaretleme. GPS varsayılan kapalıdır; ileride açılırsa yalnızca işlem anında, izin ve görünür bilgilendirmeyle. Sürekli arka plan konum toplama yapma. Personel verisi yetki scope'una göre gösterilmeli.
