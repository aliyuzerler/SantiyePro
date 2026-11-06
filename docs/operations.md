# ŞantiyePro — Operasyon Kılavuzu (Kurulum, Upgrade, Rollback)

Bu doküman müşteri sunucusunda sistem yöneticisinin operasyonel referansıdır.
Yedekleme ve geri yükleme adımları için `docs/backup-restore.md`, kurallar için
`docs/10-deployment-backup.md` esas alınır. Sürüm: **1.0.0**.

## 1. Sistem gereksinimleri

| Bileşen | Gereksinim |
| --- | --- |
| Sunucu | 2 vCPU / 4 GB RAM / 40 GB disk (100 kullanıcıya kadar; disk medya hacmine göre büyür) |
| İşletim sistemi | Linux (Ubuntu 22.04+ önerilir) |
| Docker | Docker Engine 24+ ve Compose v2 |
| Ağ | 80/443 açık; DB ve MinIO **asla** dış ağa yayımlanmaz (compose yapılandırması zaten kapatır) |
| Domain | TLS için bir alan adı; Caddy Let's Encrypt sertifikasını otomatik alır |

## 2. Sıfırdan kurulum

```bash
# 1) Teslim paketini sunucuya açın
unzip santiyepro-release-1.0.0.zip -d /opt/santiyepro
cd /opt/santiyepro

# 2) Ortam dosyasını hazırlayın — TÜM change-me değerleri güçlü rastgele değerlerle değiştirin
cp .env.example .env
openssl rand -hex 32   # JWT_ACCESS_SECRET için
openssl rand -hex 32   # JWT_REFRESH_SECRET için
openssl rand -hex 24   # ADMIN_SETUP_TOKEN için (min 20 karakter)
# POSTGRES_PASSWORD, S3_ACCESS_KEY, S3_SECRET_KEY da güçlü değerle verilmelidir.
# COOKIE_SECURE=true ve CORS_ALLOWED_ORIGINS=https://panel.firmaadi.com yapın.

# 3) İmajları derleyin ve ayağa kaldırın
docker compose -f infra/docker/docker-compose.yml up -d --build

# 4) Migration'ları çalıştırın (ilk kurulumda şema + seed)
docker compose -f infra/docker/docker-compose.yml exec api node -e \
  "console.log('migration adımı bkz. §2.1')"

# 5) İlk admin'i oluşturun (bkz. §3) ve ADMIN_SETUP_TOKEN'ı .env'den temizleyin.
```

### 2.1 Migration

Migration'lar kontrol adımıyla çalıştırılır; otomatik deploy edilmez:

```bash
docker compose -f infra/docker/docker-compose.yml exec api sh -c \
  "npx prisma migrate deploy"
```

- Migration öncesi **yedek alınır** (`docs/backup-restore.md` §2).
- `migrate deploy` yalnızca bekleyen migration'ları uygular; veri değişimi içermez.

## 3. İlk admin kurulumu

1. `GET /api/v1/auth/needs-setup` → `true` döner (kullanıcı yokken).
2. Panelin ilk açılış ekranı kurulum moduna geçer; `ADMIN_SETUP_TOKEN` ile
   ilk firma yöneticisi (FIRM_ADMIN) oluşturulur. Varsayılan parola **yoktur**;
   parola kurulum anında operatör tarafından belirlenir.
3. Kurulum tamamlandığında endpoint kilitlenir (`Kurulum daha önce tamamlandı`).
4. `.env` içindeki `ADMIN_SETUP_TOKEN` silinir; dosyada boş değer bırakılmaz —
   değişken tamamen kaldırılır ve API yeniden başlatılır.

## 4. Upgrade prosedürü

```bash
cd /opt/santiyepro
# 0) Yedek al (ZORUNLU): docs/backup-restore.md §2
# 1) Yeni paketi aç (veya git pull) ve derleyin
docker compose -f infra/docker/docker-compose.yml build
# 2) Migration'ları uygulayın
docker compose -f infra/docker/docker-compose.yml exec api sh -c "npx prisma migrate deploy"
# 3) Hizmetleri kesintisiz yeniden başlatın
docker compose -f infra/docker/docker-compose.yml up -d
# 4) Sağlık kontrolü
bash infra/scripts/health-check.sh
# 5) Kritik akış duman testi: giriş → proje → görev → günlük rapor
```

`APP_VERSION` değerini yeni sürüme güncelleyin (`.env`) — panel Ayarlar
ekranında ve `/health` yanıtında görünür.

## 5. Rollback prosedürü

```bash
# 1) Uygulamayı bakıma al (proxy'de ya da compose down ile)
docker compose -f infra/docker/docker-compose.yml stop api web
# 2) Önceki release paketine dönün (eski imajlar local'de durur)
docker compose -f infra/docker/docker-compose.yml up -d --no-build --force-recreate api web
# 3) Şema geri dönüşü GEREKLİYSE: yedekten izole restore testi (docs/backup-restore.md §3)
#    Not: geriye uyumsuz migration varsa DB yedekten döndürülür; doğrudan
#    `migrate resolve/rollback` üretime uygulanmaz.
# 4) Sağlık + duman testi, sonra bakım modundan çık
```

Kural: **veri kaybına yol açabilecek tek adım asla otomatik çalışmaz**; her
rollback kararı yedek doğrulamasından sonra insan onayıyla uygulanır.

## 6. Müşteri yöneticisi kullanımı (aylık bakım listesi)

| Görev | Nerede | Sıklık |
| --- | --- | --- |
| Son yedek zamanını kontrol et | Panel → Ayarlar → Yedekleme kartı (`/org/backup-status`) | Günlük |
| Denetim kayıtlarını incele (başarısız giriş, yetki reddi) | Panel → Denetim Kayıtları | Haftalık |
| Kullanıcı listesi: ayrılan personelin hesabını **Disable** et | Panel → Kullanıcılar | Ayrılma anında |
| Parola sıfırlama taleplerini yönet | Panel → Kullanıcılar → parola sıfırlama | Talep anında |
| Restore testi (izole ortam) | `docs/backup-restore.md` §3 | Üç aylık |
| Depolama doluluk kontrolü (MinIO + backup volume) | Sunucu | Aylık |

## 7. Güvenlik olayı prosedürü

1. **Şüpheli oturum**: Panel → Kullanıcılar → ilgili kullanıcıyı Disable et
   (tüm refresh token'ları anında iptal edilir).
2. **Parola sızıntısı şüphesi**: Kullanıcı parolasını sıfırla; gerekiyorsa tüm
   kullanıcılar için toplu parola sıfırlama uygulat (destek).
3. **Sunucu ihlali şüphesi**: Sunucuyu ağdan ayır, yedeği izole hedefe kopyala,
   destek hattına `denetim-kayitlari` dışa aktarımını (PDF/XLSX) ilet.
4. Her olay Denetim Kayıtları'ndan `traceId` ile izlenir; API loglarında parola
   veya token asla loglanmaz (test kapsamındadır).

## 8. Bilinen sınırlar (v1.0.0)

| Konu | Durum |
| --- | --- |
| Parola sıfırlama e-posta teslimatı | E-posta altyapısı müşteri SMTP'siyle konfigüre edilene kadar token yalnızca operatör akışıyla iletilir (release blocker değil; Faz 11 notu) |
| MFA / 2FA | docs/07 uyarınca MVP kapsamı dışı; yol haritasında |
| Rate limiter | Tek örnek (single-node) in-memory; çoklu örnek dağıtımda Redis tabanlıya geçilmeli |
| Swagger | Üretimde kapalı; gerektiğinde `NODE_ENV != production` koşumunda kullanılır |
