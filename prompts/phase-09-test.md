# Phase 09 — Test Promptu

Offline/sync testleri gerçekçi ağ ve uygulama yaşam döngüsü senaryolarıyla:
1. İnternet yokken günlük rapor/task/puantaj oluştur; uygulamayı force-close edip aç; kayıtlar duruyor mu?
2. Bağlantı gelince push/pull tamamlanıyor mu?
3. Aynı mutation 3 kez gönderilince tek kayıt mı oluşuyor?
4. 401 refresh, 403, 409 conflict, 422 validation, 500 ve timeout davranışı doğru mu?
5. Fotoğraf upload ortasında bağlantı kesilip tekrar gelince dosya kaybolmadan retry oluyor mu?
6. İki cihazda aynı rapor değişirse conflict kullanıcıya gösteriliyor mu?
7. Kritik stok hareketi server onayı olmadan kesin bakiye gibi gösterilmiyor mu?
8. Silinen/erişimi kaldırılan proje verisi pull'da cihazdan temizleniyor mu?
9. Cihaz saati yanlış olduğunda sıralama server cursor/version ile tutarlı mı?
10. Outbox başarısız mutation'ı sessizce silmiyor mu?

Unit + integration + cihaz E2E testlerini çalıştır. Her senaryonun sonucu `docs/test-reports/phase-09.md` içinde olsun. Veri kaybı veya duplicate işlem varsa fazı geçme.
