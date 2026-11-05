# 06 — Rol ve Yetki Matrisi

Yetki kontrolü hem modül/işlem hem proje kapsamı seviyesinde yapılır. Aşağıdaki matris varsayılan öneridir; firma yöneticisi rollerin izinlerini kurulum ayarlarından özelleştirebilir.

| İşlem | Firma yöneticisi | Proje yöneticisi | Şantiye şefi | Teknik ofis | Depo | Muhasebe | Saha personeli |
|---|---:|---:|---:|---:|---:|---:|---:|
| Firma ayarı | ✓ | – | – | – | – | – | – |
| Kullanıcı/rol yönetimi | ✓ | sınırlı | – | – | – | – | – |
| Proje görüntüleme | tümü | atanmış | atanmış | atanmış | atanmış | atanmış | izinli |
| Proje düzenleme | ✓ | ✓ | sınırlı | sınırlı | – | – | – |
| Günlük rapor oluşturma | ✓ | ✓ | ✓ | görüntüle | – | görüntüle | – |
| Günlük rapor onayı | ✓ | ✓ | yapılandırılabilir | – | – | – | – |
| Görev atama | ✓ | ✓ | ✓ | sınırlı | – | – | – |
| Puantaj düzenleme | ✓ | ✓ | ✓ | görüntüle | – | görüntüle | kendi kaydı (opsiyonel) |
| Stok hareketi | ✓ | ✓ | sınırlı | görüntüle | ✓ | görüntüle | – |
| Gider oluşturma | ✓ | ✓ | sınırlı | sınırlı | – | ✓ | – |
| Gider onayı | ✓ | yapılandırılabilir | – | – | – | ✓ | – |
| Hakediş hazırlama | ✓ | ✓ | görüntüle | ✓ | – | ✓ | – |
| Hakediş onayı | ✓ | yapılandırılabilir | – | – | – | ✓ | – |
| Rapor/dışa aktarma | ✓ | ✓ | proje kapsamı | proje kapsamı | stok kapsamı | finans kapsamı | – |
| Audit log görüntüleme | ✓ | sınırlı | – | – | – | – | – |

## Zorunlu kurallar
- `ADMIN` rolü dahi API'nin kimlik doğrulama ve audit mekanizmasını atlayamaz.
- Proje erişimi olmayan kullanıcı proje ID'sini URL'de değiştirerek veri okuyamaz veya yazamaz.
- Yetki kontrolleri nesne seviyesinde yapılır (IDOR koruması).
- Mobil menüde görünmeyen aksiyon API üzerinden de engellenir.
- Rol değişiklikleri ve kullanıcı devre dışı bırakma audit log üretir.
- Saha personelinin kişisel verilerine erişim görev gereği minimumda tutulur.
