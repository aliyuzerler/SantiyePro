# Phase 07 — Test Promptu

Stok testleri:
- Malzeme/depo CRUD, birim ve miktar validasyonu.
- IN/OUT/TRANSFER/RETURN/ADJUSTMENT/REVERSAL iş kuralları.
- Stoktan fazla çıkış engeli.
- İki eşzamanlı çıkışla negatif stok oluşmaması.
- Transferin atomikliği: bir taraf başarısızsa iki taraf da rollback.
- Duplicate clientMutationId tekrar stok düşürmüyor mu?
- Geçmiş hareket fiziksel silinemiyor/değiştirilemiyor mu?
- Project scope, depo yetkisi ve audit log.
- Büyük hareket listesinde pagination ve indeks performansı.

Gerçek PostgreSQL integration test çalıştır; mock transaction ile yetinme. Lint/typecheck/test/build ve `docs/test-reports/phase-07.md` raporunu tamamla.
