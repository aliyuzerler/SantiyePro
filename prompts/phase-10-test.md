# Phase 10 — Test Promptu

Raporlama ve operasyon testleri:
- Her rapor gerçek DB verisi ve doğru yetki scope'u kullanıyor mu?
- Filtreler hem ekranda hem dışa aktarmada aynı sonucu veriyor mu?
- PDF Türkçe karakter, sayfa taşması ve tarih aralığı doğru mu?
- XLSX hücreleri sayı/tarih tipinde mi?
- Büyük veri export bellek tüketimi kontrol altında mı?
- Export audit log oluşturuyor mu?
- Audit log yetkisiz erişim engelli ve hassas alanlar maskeli mi?
- Backup DB + object storage verisini kapsıyor mu?
- Restore testi yeni/izole test ortamında başarılı mı?
- Migration sonrası rollback/upgrade talimatları tutarlı mı?

Gerçek staging benzeri Compose ortamında test et. `docs/test-reports/phase-10.md` içinde test verisini, restore adımlarını ve sonucu yaz.
