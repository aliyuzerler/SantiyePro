# ADR-003 — Offline-first mobil

**Durum:** Kabul edildi

Şantiyelerde bağlantı kesintisi olağan kabul edilir. Mobil kayıt önce SQLite/outbox'a alınır, sonra idempotent API ile senkronize edilir. Finansal/stok işlemleri server doğrulaması ve conflict handling olmadan kesinleşmiş gösterilmez.
