# Phase 08 — Gider ve Hakediş

## Geliştirme promptu

`docs/04-data-model.md`, `docs/05-api-contracts.md`, `docs/06-roles-permissions.md`, `docs/07-security-rules.md` ve tasarım ekran spesifikasyonlarını oku.

Expense, ExpenseCategory, ContractItem, ProgressClaim ve ProgressClaimLine tablolarını kur. Gider oluşturma, kategori, tedarikçi, tarih, tutar, para birimi, opsiyonel vergi alanı, fiş/fatura eki, onay/red akışlarını geliştir.

Hakediş için sözleşme kalemleri, birim, sözleşme miktarı, birim fiyatı, dönem başlangıç/bitiş, önceki miktar, dönem miktarı, kümülatif miktar, kesinti ve net tutar akışını kur. Hesaplama domain service içinde ve decimal hassasiyetiyle yapılmalı. Fiyat snapshot'ı saklanmalı. Onaylanmış hakediş yeniden hesaplanarak geçmişi değiştirmemeli.

Vergi/tevkifat oranı veya yasal hesaplama uydurma; alanları yapılandırılabilir tut ve varsayılan oranı kendiliğinden ekleme. Formül açıklaması ve onay önizlemesi göster. PDF/Excel çıktısına altyapı hazırla; rapor çıktısı Phase 10'da tamamlanabilir.

UI'da hassas tutarlar sağa hizalı, para birimi açık ve taslak/onay durumu belirgin olmalı.
