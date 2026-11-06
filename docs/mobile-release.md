# ŞantiyePro — Mobil Sürüm Build Yönergesi (Android / iOS)

Uygulama: Expo SDK 58 + React Native (`apps/mobile`). Sürüm: **1.0.0**
(`apps/mobile/app.json` → `version` ve `runtimeVersion` ile uyumlu tutulur).

## 1. Önce okunun

- Offline-first sync mimarisi: `docs/09-offline-sync.md`
- Mobil güvenlik: `docs/07-security-rules.md` (SecureStore, izin politikası)
- Sürümleme: `docs/10-deployment-backup.md` §Sürümleme (SemVer)

## 2. Android release build (APK / AAB)

```bash
cd apps/mobile

# 2.0) API adresi üretim değerine sabitlenir — secret GÖMÜLMEZ (docs/07);
#      yalnızca public base URL gömülür (token'lar SecureStore'da tutulur).
export EXPO_PUBLIC_API_URL=https://panel.firmaadi.com/api/v1

# 2.1) Release build (AAB — Google Play içi dağıtım için)
npx eas build --platform android --profile production

#    Veya yerel imza ile (eas-cli olmadan):
npx expo prebuild --platform android --clean
cd android && ./gradlew bundleRelease   # app-release.aab üretir
cd android && ./gradlew assembleRelease # doğrudan cihaz için APK
```

Keystore yönetimi:
- Üretim keystore'u `.jks` dosyası **repoya girmez**; müşteri/yayıncı kasasında saklanır.
- Şifreler `android/gradle.properties` yerine ortam değişkeniyle verilir.
- Keystore kaybı durumunda Google Play App Signing kullanılıyorsa kurtarma mümkündür;
  kurum dışı dağıtımda keystore + şifreler müşteriye teslim edilir.

Sahha dağıtımı (Google Play olmadan):
- `assembleRelease` çıktısı imzalı APK müşteri MDM/indirme linkiyle dağıtılır.
- `docs/12-release-checklist.md` gereği gerçek cihaz saha testi yapılır:
  çevrimdışı kayıt → uçuş modu → geri dönüş senaryosu.

## 3. iOS build (gerekli hesap ve sertifika adımları)

Ön koşullar:
1. **Apple Developer Program** üyeliği (yıllık ücretli; firma hesabı önerilir).
2. **App Store Connect** üzerinde uygulama kaydı (bundle id: müşteriye özel,
   örn. `com.firmaadi.santiyepro`).
3. Sertifikalar: Apple Distribution certificate + provisioning profile
   (EAS kullanılıyorsa `eas credentials` ile otomatik yönetilir).
4. Push notification kullanılacaksa APNs Key (.p8) App Store Connect'ten üretilir.

```bash
cd apps/mobile
npx eas build --platform ios --profile production
# veya yerel macOS:
npx expo prebuild --platform ios --clean
cd ios && xcodebuild -workspace santiyepro.xcworkspace -scheme santiyepro -configuration Release archive
```

Not: İlk sürüm tesliminde iOS App Store dağıtımı yerine TestFlight veya
kurumsal (Apple Business Manager) dağıtım tercih edilebilir; karar müşteriyle
yazılı olarak netleştirilir (`docs/12` Ticari teslim maddeleri).

## 4. Sürüm ve sürüm notu disiplini

- `version` (SemVer) ve Android `versionCode` her release'te artırılır.
- Sürüm notu `docs/release-notes.md`'e işlenir; panel Ayarlar ekranındaki
  sürüm bilgisi API `APP_VERSION` ile uyumlu olmalıdır.
- Build çıktısı SHA-256 özeti teslim formuna eklenir.

## 5. Bilinen sınırlar (v1.0.0)

- Fotoğraf yüklemede çözünürlük/sıkıştırma istemcide makul seviyeye düşürülür
  (docs/08); orijinal çözünürlük korunmaz.
- Uzun GPS izleme yoktur; konum yalnızca izinle ve iş anında kullanılır.
- Otomatik güncelleme mekanizması yoktur; güncellemeler yönergeyle dağıtılır.
