# Faz 01 Test Raporu — Tasarım Sistemi ve App Shell

**Tarih:** 2026-11-05 · **Kapsam:** `design/01-04` + `tokens.json` uygulaması, web/mobil uygulama kabuğu

## Test promptu denetim listesi

| Kontrol | Durum | Kanıt / Not |
|---|---|---|
| Token değerleri `design/tokens.json` ile eşleşiyor | ✅ PASS | Üç yönlü parity testi: `packages/contracts/test` (tokens.ts ↔ tokens.json), `apps/web/src/test/tokens.test.ts` (globals.css @theme ↔ tokens.json), `apps/mobile/__tests__/tokens.test.ts` (RN köprüsü contracts referansı — kopya yok). |
| Web 1440/1024/768 px taşma | ✅ PASS | Sidebar 1024px altına kadar sabit 248px; 768px altında hamburger + drawer; grid `lg:grid-cols-2` kırılımı. Manuel viewport kontrolü tarayıcı doğrulamasıyla yapıldı (aşağıda). |
| Mobil küçük ekran taşma | ✅ PASS (statik) | Tüm ekranlar tek kolon, `padding: 16` (gutter token), dikey kaydırma; RTL `flexWrap` kullanılmadı. Cihaz doğrulaması Manuel QA. |
| Buton/input/select focus, disabled, loading, error | ✅ PASS | Web: `components.test.tsx` — disabled tıklamaz, loading `aria-busy` + kilit, error `role=alert` + `aria-invalid` + `aria-describedby`. Mobil: `ui.test.tsx` — `accessibilityState {disabled,busy}`. |
| Dokunma hedefleri ≥ 44 dp | ✅ PASS | Mobil `touch.min=44`, `touch.preferred=48`; Button `minHeight:48/minWidth:44`; tab butonları `minWidth:44/minHeight:44`. Test ile sabitlenir. |
| Klavye ile web navigasyonu | ✅ PASS | `:focus-visible` halkası globals.css'te; link/buton native odaklanabilir; ConfirmDialog Escape ile kapanır (test). |
| Renk kontrastı + renk dışı durum anlatımı | ✅ PASS | Tüm StatusBadge'ler metin + ikon taşır (test); lacivert `#14263D` üzerinde beyaz metin kontrastı > 12:1, amber zeminde koyu lacivert metin. |
| Sidebar, topbar, bottom navigation, + Kayıt | ✅ PASS | Web: Sidebar/topbar AppShell bileşen testleri + build. Mobil: `app-shell.test.tsx` — 4 sekme + `Yeni kayıt ekle` FAB + RecordMenuSheet 5 kayıt türü (design/02 listesi). |
| Empty/loading/error ekranları tutarlı | ✅ PASS | Web ve mobil aynı semantiği paylaşır: EmptyState (açıklamalı, faz bilgili), ErrorState (retry), LoadingSkeleton (aria-busy). Sahte KPI yok. |
| Console/a11y/TS hatası | ✅ PASS | `pnpm -r typecheck` 0 hata; jest-vitest uyarı yok; `next build` başarılı (static export hazır). |

## Kalite kapısı çıktıları

```
lint       : 4/4 paket Done
typecheck  : 4/4 paket Done
build      : contracts (CJS dist) + api (nest build, ESM dist) + web (next build) OK
test       :
  contracts : 1 passed   (token parity: tokens.ts ↔ design/tokens.json)
  api unit  : 4 passed
  api e2e   : 5 passed   (health uçları + hata zarfı + traceId)
  web       : 20 passed  (token uyumu + bileşen durumları + dialog)
  mobile    : 17 passed  (token köprüsü + bileşenler + kayıt menüsü + kabuk smoke)
```

## Uygulanan tasarım sistemi

- **Web** (`apps/web`): Tailwind 4 `@theme` ile tokens.json → CSS değişkenleri (`bg-brand-900`, `text-text-primary`…). Bileşenler: `Button` (4 varyant × 5 durum), `TextField/TextArea/Select` (etiket üstte, zorunlu yıldız, hata altta), `Card/SectionCard`, `StatusBadge` (7 ton, ikon+metin), `EmptyState/ErrorState/LoadingSkeleton`, `ConfirmDialog` (Escape, focus), `Spinner`. Shell: `AppShell` + `Sidebar` (248px lacivert, amber inset aktif öğe, 768px drawer) + `Topbar` (breadcrumb, devre dışı proje seçici Faz 03 notu) + `PageHeader` + `Breadcrumbs`.
- **Mobil** (`apps/mobile`): contracts token köprüsü (`src/theme/tokens.ts`), `Button/TextField/Card/StatusBadge/EmptyState/ErrorState/LoadingSkeleton`, `RecordMenuSheet` (design/02'deki 5 kayıt türü, faz notlarıyla devre dışı), `RootTabs` (Ana Sayfa · Projeler · **+Kayıt FAB** · Görevler · Profil), Lucide ikon seti (`lucide-react-native` + `react-native-svg`).
- **Menü öğeleri** web'de 11 sayfa olarak hazır; her biri modülün geleceği fazı açıkça belirten boş durum gösterir (sahte veri yok, design/03 kuralı).

## Teknik kararlar

| Karar | Gerekçe |
|---|---|
| Web test koşucusu Vitest'e geçirildi (jest yerine) | Nest 12 starter'ı Vitest'e geçti; API+web tek koşucu, mobil jest-expo ile kaldı (RN resmi yolu). |
| Tailwind 4 CSS-first `@theme` | tokens.json ↔ CSS eşleşmesi otomatik utility üretimiyle korunur; ayrı tailwind.config dosyası gereksiz. |
| Lucide ikonları: web'de geçici unicode glif, mobilde gerçek `lucide-react-native` | Web'de Faz 02'de `lucide-react` eklenene kadar tek kaynak preview.html glifleri kullanıldı; karışım önlendi. |
| Mobilde jest `setupFilesAfterEnv` + safe-area resmi mock | `SafeAreaProvider` test ortamında çocukları mount etmiyor; resmi jest mock'u sıfır inset ile çocukları render ediyor. |
| `lucide-react-native` jest shim'i | Paket jest'te ESM (.mjs) çözülüyor; test kabuğunda ikonlar görsel ayrıntı olduğundan `src/test/shims/lucide.ts` ile map edildi. |
| Web font: Inter sistem yığını (`Inter, Roboto, SF Pro, system-ui`) | Webfont indirme build'te ağ bağımlılığı yaratmasın; design/01 platform fallback'ine uygun. Faz 11'de self-host Inter kararı alınabilir. |

## Manuel QA maddeleri (sandbox'ta doğrulanamayanlar)

1. Gerçek Android/iOS cihazda klavye, safe area, geri tuşu davranışı (rules/02).
2. `expo start` ile Expo Go üzerinde kabuk gezinmesi.
3. Gerçek cihazda 44dp dokunma hedefinin parmakla algısı.

**Sonuç: FAZ 01 TAMAMLANDI** — test kapısı geçildi; Faz 02'ye (Authentication, Users, RBAC) hazır.
