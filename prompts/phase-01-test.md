# Phase 01 — Test Promptu

Tasarım sistemi ve shell'i doğrula:
- Token değerleri `design/tokens.json` ile eşleşiyor mu?
- Web 1440/1024/768 px ve mobil küçük ekranlarda taşma var mı?
- Buton/input/select focus, disabled, loading ve error durumları doğru mu?
- Dokunma hedefleri en az 44 dp mi?
- Klavye ile web navigasyonu yapılabiliyor mu?
- Renk kontrastı ve durumların renk dışı metin/ikon anlatımı kontrol edildi mi?
- Sidebar, topbar, bottom navigation ve + Kayıt aksiyonu çalışıyor mu?
- Empty/loading/error ekranları tutarlı mı?
- Console warning, accessibility warning veya TypeScript hatası var mı?

Gerekirse ekran görüntüsü/viewport testleri oluştur. Sorunları düzelt, lint/typecheck/test/build çalıştır ve `docs/test-reports/phase-01.md` raporunu yaz.
