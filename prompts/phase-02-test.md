# Phase 02 — Test Promptu

Auth ve RBAC güvenlik testlerini çalıştır:
1. Doğru/yanlış parola; kullanıcı var/yok ayrımı sızıyor mu?
2. Parola DB'de hash mi; düz metin yok mu?
3. Access token süresi, refresh rotation, reuse ve logout revoke çalışıyor mu?
4. Disable edilen kullanıcının refresh token'ı reddediliyor mu?
5. Yetkisiz rol endpoint'e erişemiyor mu?
6. IDOR benzeri başka kullanıcı/rol kaydına erişim engelli mi?
7. Rate limit ve generic error doğru mu?
8. Web cookie HttpOnly/Secure/SameSite ayarları production konfigürasyonunda doğru mu?
9. Mobil token AsyncStorage veya SQLite'a yazılmıyor, SecureStore'da mı?
10. İlk admin oluşturma akışı güvenli ve tek kullanımlık mı?

Integration/E2E test ekle; lint, typecheck, test, build çalıştır. `docs/test-reports/phase-02.md` raporunu oluştur. Kritik güvenlik testi başarısızsa ilerleme.
