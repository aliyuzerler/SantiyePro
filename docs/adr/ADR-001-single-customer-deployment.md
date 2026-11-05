# ADR-001 — Tek müşteri / tek kurulum

**Durum:** Kabul edildi

İlk sürümde her müşterinin ayrı deployment, ayrı DB ve dosya deposu bulunur. Ortak SaaS tenant izolasyonu, abonelik ve merkezi billing geliştirilmez. Bu karar müşteriye tek seferlik lisansla teslimatı kolaylaştırır ve müşteri verilerinin kurulum bazında ayrılmasını sağlar.

Gelecekte merkezi SaaS istenirse organization sınırı korunur; ancak gerçek multi-tenant izolasyon ayrıca tehdit modeli, migration ve test gerektirir.
