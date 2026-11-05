# Backend Geliştirme Kuralları
- Controller ince; iş kuralı service/domain katmanında.
- DTO doğrulama ve auth/permission guard her endpoint'te.
- DB değişiklikleri Prisma migration ile.
- Kritik çoklu yazma transaction içinde.
- Para DECIMAL; floating point ile muhasebe hesabı yok.
- Audit log kritik işlemlerle aynı transaction içinde yazılmalı (uygun olduğunda).
- Pagination zorunlu; sınırsız liste endpoint'i oluşturma.
- Raw SQL gerekirse parametrik ve açıklamalı.
