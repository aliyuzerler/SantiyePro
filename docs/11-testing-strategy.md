# 11 — Test Stratejisi

## Test katmanları
- Unit: domain hesapları, validasyon ve utility'ler.
- Integration: service + Prisma test DB, transaction, permission.
- API/E2E: HTTP uçları, auth, rol ve proje scope kontrolleri.
- Web E2E: Playwright ile kritik panel akışları.
- Mobile component/integration: React Native Testing Library.
- Device QA: gerçek Android cihaz; iOS cihaz/simülatör hazır olduğunda.
- Offline QA: ağ kapatma, uygulama kapatma, kuyruk ve retry senaryoları.
- Security QA: auth, IDOR, upload, rate limit, secrets ve dependency taraması.

## Kritik iş kuralları için test zorunluluğu
- Proje erişimi olmayan kullanıcı veriyi okuyamaz/yazamaz.
- Stoktan fazla çıkış reddedilir.
- Transfer atomik gerçekleşir.
- Duplicate clientMutationId ikinci hareket oluşturmaz.
- Onaylı hakedişin fiyat snapshot'ı değişmez.
- Reddedilmiş rapor tekrar taslağa alınabilir; eski revizyon korunur.
- Kullanıcı devre dışı bırakılınca refresh token kullanılamaz.
- Upload URL yetkisiz kullanıcıya verilmez.

## Her faz sonrası kalite kapısı
1. Fazın test promptunu çalıştır.
2. Lint + typecheck + unit/integration test + build.
3. Değişen ekranlarda loading/empty/error/offline/permission state kontrolü.
4. API endpoint'lerinde olumlu ve olumsuz yetki testi.
5. Test sonuçlarını `docs/test-reports/phase-XX.md` olarak kaydet.
6. Başarısız test varsa fazı tamamlandı ilan etme.

## Test verisi
Gerçek çalışan adı, telefon, adres veya gerçek mali kayıt kullanma. Seed verileri açıkça sentetik olmalı. Test ortamı production veritabanına bağlanmamalı.
