# ADR-002 — Modüler monolit

**Durum:** Kabul edildi

NestJS backend tek deployable uygulama olarak başlar; domain modülleri ayrıdır. İlk müşteri segmentinde mikroservislerin operasyonel maliyeti gereksizdir. Modüller arası doğrudan DB erişimi yerine servis arayüzleri korunur.
