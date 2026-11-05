# Phase 08 — Test Promptu

Gider/hakediş testleri:
- Gider CRUD, kategori, tutar/para birimi validasyonu.
- Onay/red ve rol kontrolleri.
- Hakediş formülü için bilinen örnekler ve edge case'ler.
- Decimal precision/rounding; floating point hatası yok.
- Fiyat snapshot'ı, contract item fiyatı değişince eski hakediş etkilenmiyor mu?
- Onaylı hakediş düzenleme/silme engeli ve iptal politikası.
- Kesinti/net tutar kontrolleri.
- Aynı döneme ait numara/benzersizlik kuralı.
- Audit log ve proje scope.
- Tutarların web/mobilde doğru biçimlendirilmesi.

Finansal hesaplar için unit + gerçek DB integration testleri yaz. Lint/typecheck/test/build çalıştır; `docs/test-reports/phase-08.md` raporunu oluştur.
