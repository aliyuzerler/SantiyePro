# Faz Promptları Nasıl Çalıştırılır?

Sırayı bozma. Her fazda geliştirme promptunu önce çalıştır, ardından o fazın test promptunu çalıştır. Testler başarısızsa sonraki faza geçme.

| Sıra | Faz | Çıktı |
|---:|---|---|
| 00 | Keşif ve iskelet | Repo analizi, çalışma alanı ve kararlar |
| 01 | Tasarım sistemi ve uygulama kabuğu | Token, navigasyon, temel UI |
| 02 | Kimlik, kullanıcı ve yetki | Güvenli giriş ve RBAC |
| 03 | Proje ve şantiye | Proje yaşam döngüsü |
| 04 | Görev yönetimi | Atama, durum ve yorum |
| 05 | Günlük rapor ve medya | Fotoğraflı saha raporu |
| 06 | Personel ve puantaj | Devam kayıtları |
| 07 | Depo ve malzeme | Stok hareketleri |
| 08 | Gider ve hakediş | Finansal kayıtlar ve hesaplama |
| 09 | Offline sync | Mobil outbox ve çakışma yönetimi |
| 10 | Raporlama, audit, backup | Yönetim ve teslim kabiliyetleri |
| 11 | Güvenlik, performans ve release | Üretime hazırlık |

## ZCode'a her prompt öncesi hatırlatma
`agents.md`, ilgili `docs/`, `design/` ve `rules/` dosyalarını oku. Yalnızca belirtilen fazı uygula. Tamamlanmış kod, test ve build üretmeden fazı bitti sayma.
