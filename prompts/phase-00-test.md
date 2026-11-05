# Phase 00 — Test Promptu

Phase 00 geliştirmesini denetle. Ürün dokümanlarını tekrar oku ve aşağıdakileri gerçekten çalıştır:
1. Temiz kurulumda package manager install başarılı mı?
2. Workspace paketleri doğru çözülüyor mu?
3. Mobile, web ve API uygulamaları başlatılabiliyor mu?
4. API health endpoint 200 dönüyor mu?
5. PostgreSQL ve object storage Compose servisleri healthy oluyor mu?
6. Lint, typecheck, test ve build script'leri tutarlı mı?
7. `.env` ve secret'lar git dışında mı? `.env.example` gerçek secret içeriyor mu?
8. CI dosyası mevcut komutları gerçekten çağırıyor mu?
9. README'deki komutlar temiz makinede uygulanabilir mi?

Eksik veya başarısız maddeleri düzelt. Test çıktısını `docs/test-reports/phase-00.md` dosyasına yaz. Başarısız kalan adım varsa fazı tamamlandı olarak işaretleme; sonraki faza geçme.
