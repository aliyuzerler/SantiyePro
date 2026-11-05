# 05 — API Sözleşmesi ve İş Kuralları

## Genel kurallar
- Prefix: `/api/v1`.
- Tüm uçlarda authentication ve permission guard varsayılan davranıştır; public uçlar açıkça işaretlenir.
- DTO doğrulaması server-side yapılır; bilinmeyen alanlar reddedilir veya whitelist ile atılır.
- Liste yanıtı: `{ data: [], meta: { page, pageSize, total, totalPages } }`.
- Hata yanıtı: `{ error: { code, message, details? }, traceId }`.
- Request/response örnekleri OpenAPI'de tutulur.

## Önerilen endpoint grupları

| Alan | Örnek endpoint |
|---|---|
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout` |
| Users | `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/disable` |
| Projects | `GET/POST /projects`, `GET/PATCH /projects/:id`, `/projects/:id/members` |
| Sites | `GET/POST /projects/:projectId/sites` |
| Tasks | `GET/POST /tasks`, `PATCH /tasks/:id`, `/tasks/:id/comments` |
| Daily reports | `GET/POST /daily-reports`, `POST /daily-reports/:id/submit`, `/approve`, `/reject` |
| Attendance | `GET/POST /attendance`, `POST /attendance/bulk` |
| Inventory | `GET/POST /materials`, `/warehouses`, `POST /stock-movements` |
| Expenses | `GET/POST /expenses`, `POST /expenses/:id/approve` |
| Hakediş | `GET/POST /progress-claims`, `POST /progress-claims/:id/calculate`, `/approve` |
| Media | `POST /media/upload-url`, `POST /media/complete`, `GET /media/:id/download-url` |
| Reports | `GET /reports/project-summary`, `/attendance`, `/inventory`, `/expenses` |
| Sync | `POST /sync/push`, `GET /sync/pull?cursor=...` |

## Hakediş hesap politikası
- Hesaplama para ve miktar hassasiyetiyle yapılır; JS floating point ile nihai tutar hesaplama.
- `lineAmount = periodQuantity × unitPriceSnapshot`.
- `cumulativeQuantity = previousQuantity + periodQuantity`.
- Dönem toplamı = satır tutarları toplamı.
- Net hakediş = dönem toplamı - tanımlı kesintiler. Vergi/tevkifat gibi kalemler müşteri sözleşme tipine göre ayrıca konfigüre edilmelidir; varsayılan oran veya yasal yorum uydurma.
- Hesaplama sonucu kullanıcıya onaydan önce önizleme olarak gösterilir. Onaylanan hakediş snapshot olarak saklanır.

## Stok hareketi kuralları
- Hareket kaydetme transaction içerisinde yapılır.
- Transfer, kaynak depoda çıkış ve hedef depoda giriş olarak tek atomik işlem olmalıdır.
- Düzeltme doğrudan eski hareketi değiştirmez; ters kayıt/adjustment oluşturur.
- Hareketin `clientMutationId` alanı tekrar gönderimde idempotent davranış sağlar.

## Günlük rapor durumları
`DRAFT -> SUBMITTED -> APPROVED` veya `SUBMITTED -> REJECTED -> DRAFT`. Onaylı rapor değişikliği revizyon olarak kaydedilir; önceki içerik denetim için korunur.

## Dosya yükleme
- Upload URL yalnızca yetkili kullanıcılara verilir.
- İmzalı URL kısa ömürlüdür.
- Upload tamamlandığında boyut, MIME ve checksum doğrulanır.
- Medya bir entity'ye bağlanırken kullanıcının o entity üzerinde erişimi yeniden kontrol edilir.
