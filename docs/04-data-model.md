# 04 — Veri Modeli Taslağı

Bu belge başlangıç modelidir. ZCode, her fazda migration üretmeli ve model değişikliğini gerekçelendirmelidir. Tüm tablolarda uygun UUID/CUID primary key, `createdAt`, `updatedAt` ve gerektiğinde `deletedAt` kullan.

## Temel tablolar

### Organization
`id`, `name`, `legalName?`, `logoFileId?`, `timezone`, `currency`, `dateFormat`, `phone?`, `email?`, `address?`, `createdAt`, `updatedAt`.

Tek kurulumda tek Organization kaydı bulunur. Bu tablo çoklu tenant uygulaması anlamına gelmez; firma ayarları ve gelecekte taşınabilirlik içindir.

### User / Role / Permission
- User: `id`, `fullName`, `email`, `phone?`, `passwordHash`, `status`, `lastLoginAt?`.
- Role: `id`, `name`, `isSystem`.
- Permission: `id`, `key`, `description`.
- UserRole: kullanıcı-rol bağlantısı.
- RolePermission: rol-yetki bağlantısı.
- ProjectMember: `projectId`, `userId`, proje içi rol/scope.

Sadece global rol yeterli değil; proje üyeliğiyle kaynak kapsamını da kontrol et.

### Project / Site
- Project: `id`, `code`, `name`, `clientName?`, `description?`, `address?`, `startDate?`, `plannedEndDate?`, `actualEndDate?`, `contractAmount?`, `status`, `managerId?`.
- Site: `id`, `projectId`, `name`, `address?`, `status`.

### Task
`id`, `projectId`, `siteId?`, `title`, `description?`, `status`, `priority`, `assigneeId?`, `dueAt?`, `createdById`, `completedAt?`, `version`.
- TaskComment: `taskId`, `userId`, `body`.
- TaskStatusHistory: `taskId`, `fromStatus`, `toStatus`, `changedById`, `changedAt`.

### DailyReport
`id`, `projectId`, `siteId?`, `reportDate`, `weather?`, `workSummary`, `workforceSummary?`, `equipmentSummary?`, `issues?`, `safetyNotes?`, `nextDayPlan?`, `status` (DRAFT/SUBMITTED/APPROVED/REJECTED), `revisionNo`, `createdById`, `submittedAt?`, `approvedById?`.
- DailyReportRevision: önceki sürümün snapshot/hash'i veya değişen alanlar.
- DailyReportWorker: raporda yer alan personel/saat özeti.
- DailyReportMedia: rapor-medya ilişkisi.

### Personnel / Attendance
- Personnel: `id`, `employeeCode?`, `fullName`, `phone?`, `jobTitle?`, `companyOrSubcontractor?`, `status`.
- AttendanceRecord: `id`, `projectId`, `siteId?`, `personnelId`, `workDate`, `status`, `checkInAt?`, `checkOutAt?`, `workedMinutes?`, `note?`, `recordedById`, `source`, `clientMutationId?`.

Unique constraint örneği: kurum kuralı tek günlük kayıt istiyorsa `(personnelId, projectId, workDate, shiftKey)`.

### Inventory
- Warehouse: `id`, `projectId?`, `name`, `location?`.
- Material: `id`, `code?`, `name`, `category?`, `unit`, `minStock?`, `isActive`.
- StockMovement: `id`, `materialId`, `warehouseId`, `projectId?`, `type` (IN/OUT/TRANSFER/RETURN/ADJUSTMENT/REVERSAL), `quantity`, `unitCost?`, `referenceType?`, `referenceId?`, `note?`, `createdById`, `occurredAt`, `reversesMovementId?`, `clientMutationId?`.
- StockBalance bir görünüm veya transaction'la güncellenen özet olabilir; hareket kaydı asıl kaynaktır.

### Expenses / Progress Claims
- Expense: `id`, `projectId`, `categoryId`, `vendorName?`, `description`, `amount` (decimal), `currency`, `taxRate?`, `expenseDate`, `status`, `receiptMediaId?`, `createdById`, `approvedById?`.
- ExpenseCategory: `id`, `name`, `isActive`.
- ContractItem: `id`, `projectId`, `code?`, `description`, `unit`, `contractQuantity`, `unitPrice`, `currency`, `sortOrder`.
- ProgressClaim: `id`, `projectId`, `periodStart`, `periodEnd`, `claimNo`, `status`, `previousTotal?`, `deductionTotal?`, `notes?`, `createdById`, `approvedById?`.
- ProgressClaimLine: `id`, `progressClaimId`, `contractItemId`, `periodQuantity`, `previousQuantity`, `cumulativeQuantity`, `unitPriceSnapshot`, `lineAmount`.

Finansal değerler PostgreSQL `NUMERIC/DECIMAL` olarak tutulmalı; API'de decimal string olarak taşınmalı. Formül ve yuvarlama politikası `docs/05-api-contracts.md` içinde açıklanmalıdır.

### Media / Audit / Sync
- MediaFile: `id`, `storageKey`, `originalName`, `mimeType`, `sizeBytes`, `checksum`, `uploadedById`, `createdAt`, `scanStatus`.
- AuditLog: `id`, `actorUserId?`, `action`, `entityType`, `entityId`, `beforeJson?`, `afterJson?`, `ip?`, `userAgent?`, `createdAt`, `traceId?`.
- SyncMutation: `id`, `clientMutationId`, `userId`, `entityType`, `entityId?`, `status`, `receivedAt`, `processedAt?`, `errorCode?`.

## İndeksleme önerileri
- Project: `status`, `code`, `name`.
- DailyReport: `(projectId, reportDate)`, `status`.
- AttendanceRecord: `(projectId, workDate)`, `(personnelId, workDate)`.
- StockMovement: `(materialId, warehouseId, occurredAt)`, `(projectId, occurredAt)`.
- Expense: `(projectId, expenseDate, status)`.
- Task: `(projectId, status, dueAt)`, `(assigneeId, status)`.
- AuditLog: `(entityType, entityId, createdAt)`, `(actorUserId, createdAt)`.

## Veri bütünlüğü
- Stok çıkışı mevcut stoktan fazla olamaz; eşzamanlı hareketler transaction ve kilitleme/atomik kontrol ile korunur.
- Hakediş hesapları snapshot fiyat kullanır; geçmiş hakediş, sözleşme kalemi fiyatı değişti diye değişmez.
- Onaylanmış kayıt doğrudan silinmez; iptal/ters kayıt ve açıklama zorunludur.
- Benzersiz `clientMutationId` senkronizasyonda aynı isteğin iki kez işlenmesini önler.
