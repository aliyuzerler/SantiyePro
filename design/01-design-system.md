# Tasarım Sistemi — Kurumsal İnşaat Teknolojisi

## Görsel yön
Ürün; güven veren, teknik, kurumsal ve saha koşullarında hızlı kullanılabilir olmalı. İnşaat sektörünü çağrıştırmak için sarı-siyah uyarı estetiğini aşırı kullanma. Ana yüzeyler açık ve ferah; koyu lacivert kurumsal omurga, amber vurgu rengi olmalı. Gradient, cam efekti, aşırı gölge ve dekoratif animasyon kullanma.

## Renk token'ları

| Token | HEX | Kullanım |
|---|---|---|
| `brand.900` | `#14263D` | Ana lacivert, sidebar, başlık |
| `brand.800` | `#1D3553` | Hover/aktif koyu yüzey |
| `brand.600` | `#2E5B83` | Link ve ikincil vurgu |
| `accent.500` | `#D99A2B` | Birincil CTA / önemli vurgu |
| `accent.100` | `#FFF3D9` | Amber arka plan |
| `surface.0` | `#FFFFFF` | Kart/form yüzeyi |
| `surface.50` | `#F5F7FA` | Uygulama arka planı |
| `surface.100` | `#E9EEF3` | Bölüm arka planı |
| `border.default` | `#D8E0E8` | Kenarlık |
| `text.primary` | `#172433` | Ana metin |
| `text.secondary` | `#5C6B7A` | Yardımcı metin |
| `success.600` | `#21845B` | Başarı |
| `warning.600` | `#B7791F` | Uyarı |
| `danger.600` | `#C2413A` | Hata / kritik |
| `info.600` | `#2C6EAA` | Bilgi |

Durumu yalnızca renk ile ifade etme; metin ve ikon kullan. Metin/zemin kontrastı WCAG AA hedefini karşılamalıdır.

## Tipografi
- Birincil: Inter; platform fallback: Android Roboto, iOS SF Pro.
- Web sayfa başlığı 24–28 px; bölüm başlığı 18–20 px; gövde 14–16 px; tablo 13–14 px.
- Mobil gövde 14–16 sp; kritik veri 16 sp veya daha büyük.
- Sayısal değerler hizalı ve tabular-nums destekli gösterilsin.
- Başlıklarda ağırlık 600–700; gövdede 400–500.

## Ölçü ve şekil
- 4 px temel ölçü; 8 px ritim.
- Kart radius 10–12 px; input radius 8 px; buton radius 8 px.
- Web sidebar 248 px (daraltılmış 72 px).
- Mobil ekran kenar boşluğu 16 px; tablet 24 px.
- Kart iç boşluğu 16–20 px.
- Input ve buton yüksekliği web 40–44 px, mobil en az 48 dp.
- Dokunma hedefi en az 44x44 dp.
- Border 1 px; gölgeler çok hafif, yalnızca katman ayrımı gerektiğinde.

## İkonografi
Tek bir tutarlı ikon seti (Lucide) kullan. İkon tek başına kullanılıyorsa erişilebilir label/tooltip ekle. Emoji ikon olarak kullanılmaz.

## Etkileşim durumları
Her interaktif bileşende default, hover (web), pressed, focused, disabled, loading ve error durumları tasarlanmalı. Klavye focus halkası belirgin olmalı. Form hataları alanın altında metinle gösterilmeli.

## Responsive davranış
- Web: 1440 px genişlikte tam sidebar + içerik; 1024 px'te kompakt sidebar; 768 px altında mobil menü/drawer.
- Tablet: tablo yatay kaydırma veya sütun saklama; ana aksiyon sabit görünür.
- Mobil: tek kolon, kart listeleri, alt navigasyon; büyük veri tabloları mobilde doğrudan küçültülmez.

## Grafikler
- Dashboard grafiklerinde az sayıda seri ve anlaşılır eksen kullan.
- Renkler tema token'larından gelir; sadece dekorasyon için grafik kullanma.
- Grafik yanında aynı verinin metinsel özeti bulunmalı.
