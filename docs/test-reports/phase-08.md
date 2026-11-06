# Faz 08 Test Raporu — Gider ve Hakediş

- **Tarih:** 2026-11-06
- **Kapsam:** prompts/phase-08-development.md + prompts/phase-08-test.md
- **Sonuç:** ✅ TÜM TESTLER GEÇTİ — Faz 08 kapanmaya hazır

## 1. Uygulanan kapsam

| Madde (development promptu) | Durum | Not |
| --- | --- | --- |
| Expense, ExpenseCategory, ContractItem, ProgressClaim, ProgressClaimLine tabloları | ✅ | Migration `20261106000744_phase08_expenses_claims`; Expense: amount DECIMAL(18,2), taxRate DECIMAL(5,2) NULLABLE, currency 3 harf, receiptMediaId (Faz 05 medya), expenseDate DATE; ContractItem: contractQuantity DECIMAL(18,3), unitPrice DECIMAL(18,4), (projectId, code) unique; ProgressClaim: claimNo, dönem DATE, previous/gross/cumulative/deduction/net DECIMAL(18,2), (projectId, claimNo) unique; ClaimLine: previous/period/cumulative DECIMAL(18,3), unitPriceSnapshot DECIMAL(18,4), lineAmount DECIMAL(18,2), (claimId, itemId) unique |
| Gider oluşturma: kategori, tedarikçi, tarih, tutar, para birimi | ✅ | `POST /expenses` — kategori aktifliği, proje kapsamı, tutar regex (2 ondalık), ISO benzeri 3 harf para birimi (varsayılan TRY); taslak düzenleme/silme yalnızca DRAFT'ta (creator veya FIRM_ADMIN) |
| Opsiyonel vergi alanı — oranı UYDURMA | ✅ | taxRate verilmezse `taxAmount`/`totalWithTax` null döner; hiçbir varsayılan oran eklenmez (e2e: "taxRate verilmezse vergi UYDURULMAZ" + mobil test `taxRate null`); verilirse tutar × oran/100, 2 ondalık YARIM YUKARI (contracts `expenseTaxAmount`) |
| Fiş/fatura eki | ✅ | receiptMediaId Faz 05 özel medya deposundan; varlık + scanStatus=CLEAN doğrulaması (PENDING/FLAGGED dosya 400) |
| Onay/red akışları | ✅ | Durum makinesi DRAFT → (submit) PENDING → APPROVED / REJECTED; onaylayan/red eden kim + zaman saklanır; red gerekçesi zorunlu (400); geçersiz geçişler 409; onaylı/red edilmiş PATCH/DELETE 409 |
| Sözleşme kalemleri: birim, sözleşme miktarı, birim fiyatı | ✅ | `GET/POST/PATCH /progress-claims/contract-items` — proje kapsamlı, claim.prepare izinli; fiyat güncellenebilir |
| Dönem başlangıç/bitiş, önceki/dönem/kümülatif miktar | ✅ | Satır girdisi previousQuantity + periodQuantity; kümülatif = önceki + dönem (BigInt ölçekli); dönem çakışması (REJECTED/CANCELLED hariç) 409; zincir kuralı: previousQuantity, aynı kalemdeki son hakedişin kümülatifine eşit olmalı (400) |
| Hesaplama domain service + decimal hassasiyet | ✅ | Hesaplamalar contracts/finance.ts saf fonksiyonlarında BigInt aritmetik (1e2/1e3/1e4 ölçekler); floating point yok; yuvarlama politikası AÇIK: para 2 ondalık YARIM YUKARI (0.005→0.01 testle kilitli) |
| Fiyat snapshot'ı | ✅ | Satır oluşturmada kalem fiyatı kopyalanır; kalem fiyatı sonradan değişse bile satır (ve onaylı hakediş) değişmez — e2e + canlı akış: fiyat 245.75→999 sonrası snapshot ve net tutar aynı |
| Onaylı hakediş yeniden hesaplanmaz | ✅ | `POST /progress-claims/:id/calculate` DRAFT'ta recalculated=true; PENDING/APPROVED'ta saklanan değerler (recalculated=false) — geçmiş asla yeniden hesaplanmaz |
| Kesinti ve net tutar | ✅ | deductionTotal ≥ 0 ve ≤ brüt (aşarsa 400); net = brüt − kesinti; kümülatif = önceki toplam + brüt; UI'da tfoot ile açık |
| İptal politikası | ✅ | Yalnızca DRAFT/PENDING iptal (gerekçe zorunlu); onaylı hakediş iptal edilemez (409, "düzeltme yeni mahsup hakedişiyle") |
| Aynı döneme numara/benzersizlik | ✅ | (projectId, claimNo) unique → 409; claimNo 1..9999 tam sayı |
| Formül açıklaması + onay önizlemesi | ✅ | `CLAIM_FORMULA_DESCRIPTION` API yanıtında taşınır; UI önizleme panelinde aynen gösterilir; mobil formda da kısa formül notu |
| PDF/Excel altyapısı | ✅ | Kanonik ondalık string DTO'ları + rapor uçları Faz 10 report.export ile tamamlanır (belgelendi) |
| UI: tutarlar sağa hizalı, para birimi açık, durum belirgin | ✅ | Web tablolarda `text-right tabular-nums` + `formatMoneyTr` (tr-TR, narrow sembol: ₺1.250,50); StatusBadge tonları (Taslak/Onay Bekliyor/Onaylandı/Reddedildi/İptal) |
| Audit log + kapsam (docs/06/07) | ✅ | expense.created/updated/submitted/approved/rejected/deleted, expensecategory.*, contractitem.*, claim.created/updated/lines_replaced/submitted/approved/rejected/cancelled; IDOR: kapsam dışı 404; RBAC: expense.create (admin/PM/muhasebe), expense.approve (admin/muhasebe), claim.prepare (admin/PM/teknik ofis/muhasebe), claim.approve (admin/muhasebe) |
| Mobil (docs/09) | ✅ | Hızlı Gider ekranı + `offline-expense-queue`: clientMutationId idempotency, duplicate engeli, sunucu reddi 'done' (tekrar gönderilmez), attemptCount/MAX, hydrate; RecordMenu'de 'Gider' artık aktif |
| RBAC düzeltmesi | ✅ | docs/06 "Hakediş onayı: muhasebe ✓" satırı Faz 02 eşlemesinde eksikti → ACCOUNTING'a CLAIM_APPROVE eklendi (rbac.ts) |

## 2. Test sonuçları (prompts/phase-08-test.md eşlemesi)

**Toplam: 407 spec testi — 407 geçti, 0 başarısız + canlı Playwright 21 koşu (0 başarısız, 17 koşu mobil projede tasarım gereği atlandı).**

| Paket | Tür | Sonuç |
| --- | --- | --- |
| `@santiyepro/contracts` | birim | 83/83 ✅ (**26 yeni: para ayrıştırma/biçimleme, HALF_UP yuvarlama (0.005→0.01, 0.004→0.00), floating point tuzağı (0.1×0.3=0.03), büyük tutarlar, vergi (1000×%20=200.00; 0.01×%50=0.01), hakediş satır formülü + kimlik (kümülatif − dönem = önceki), toplamlar, şema reddetmeleri, dönem bitişi < başlangıç 400, satırsız 400**) |
| `@santiyepro/api` | birim | 17/17 ✅ |
| `@santiyepro/api` | **e2e (gerçek PostgreSQL)** | **158/158 ✅** (auth 17 + attendance 23 + daily-reports 11 + **expenses 16** + **progress-claims 16** + inventory 21 + media 12 + projects 16 + tasks 21 + health 5) |
| `@santiyepro/web` | bileşen (jsdom) | 64/64 ✅ (**10 yeni: formatMoneyTr (₺1.250,50 / $50.000,00 / ham düşüş), durum etiketleri, tonlar (iptal nötr, bilinmeyen nötr), miktar/tarih biçimleri**) |
| `@santiyepro/mobile` | bileşen (RNTL) | 85/85 ✅ (**11 yeni: kuyruk 7 — enqueue/duplicate append-only/flush/permanent 4xx 'done'/deneme sayacı/hyrate — + ekran 4 — çipler, kritik akış POST (clientMutationId + taxRate null), 3 ondalık istemci reddi, çevrimdışı kuyruk bildirimi**) |
| `@santiyepro/web-e2e` | **Playwright canlı** | **21/21 ✅** (health ×2, kabuk ×3, mobil drawer ×2, görev ×3, rapor ×3, puantaj ×3, stok ×1, **gider ×1 + hakediş ×1**) |

### Test promptu maddeleri → kanıt

1. **Gider CRUD, kategori, tutar/para birimi validasyonu** → `expenses.e2e`: 3 ondalık 400, sıfır 400, harf 400, 'TR' 400; kategori adı min 2, duplicate 409; pasif kategori 400 ✅
2. **Onay/red ve rol kontrolleri** → saha personeli oluşturamaz 403; PM onaylayamaz 403; muhasebe onaylar (approvedBy dolu); red gerekçesiz 400/gerekçeli 200; kategori yönetimi firm.settings.manage ister ✅
3. **Hakediş formülü bilinen örnekler** → `progress-claims.e2e` + contracts birim: 200×245.75=49150.00; 150×245.75=36862.50; net=34362.50; önceki toplam zincirden 49150.00; kümülatif 87500.00 ✅
4. **Decimal precision/rounding; floating point yok** → BigInt ölçekli aritmetik; 0.1×0.3=0.03, 1.1×2.2=2.42, 12.345×245.7512=3033.80 (Python Decimal referansıyla doğrulandı) ✅
5. **Fiyat snapshot'ı** → kalem fiyatı 999'a çekildikten sonra onaylı hakediş satırı 245.75 + 49150.00 kalır; calculate recalculated=false ✅
6. **Onaylı hakediş düzenleme/silme engeli + iptal politikası** → PATCH/PUT lines/DELETE/cancel → 409; DRAFT cancel gerekçe saklar; REJECTED dönem serbest kalır ✅
7. **Kesinti/net tutar** → kesinti > brüt 400 ("Kesinti toplamı brüt tutarı aşamaz"); makul kesintide net doğru ✅
8. **Numara/benzersizlik** → aynı claimNo 409 (başka projede serbest); dönem çakışması 409 ✅
9. **Audit log ve proje scope** → expense.* / claim.* eylemleri DB'de doğrulanır; IDOR 404 (gider + hakediş + kalem); kapsam dışı liste boş ✅
10. **Tutarların web/mobilde biçimlendirilmesi** → web `formatMoneyTr` (₺1.250,50) + mobil kanonik string taşımı; canlı akışta satır/satır hücre değerleri ✅

### Ek düzeltmeler (faz içi)

- **Medya erken-abort sağlamlaştırma** (`media.service.ts`): boyut aşımında gövde `resume()` ile boşaltılır — istemci yazma tarafı kilitlenmesi (yavaş ortamda 30 sn+) giderildi; davranış değişmedi (413, diskte birikim yok), medya e2e 12/12 ✅
- **Stale-response yarışı** (giderler/hakedişler sayfaları): filtre değişiminde eski liste yanıtı yeni durumu ezmesin diye istek-sıra koruması (seqRef)
- **Hakedişler sayfası**: proje listesi artık seçimden bağımsız yüklenir (boş seçimde liste kilitlenmesin)
- **web-e2e yardımcı düzeltmeleri**: finance spec için ekran görüntüleri kök `docs/screenshots/` altına yazılır

## 3. Manuel doğrulama (canlı — Playwright standardı)

- `pnpm --filter @santiyepro/web-e2e exec playwright test` — gerçek API + gerçek PostgreSQL + panel dev sunucusu: **21 koşu geçti** (mobil projede tasarım gereği atlanan 17 kritik-akış spesi)
  - Faz 08 gider akışı: API ile kategori+proje kurulur → UI girişi → `/panel/giderler` → **Yeni Gider** diyaloğu (vergi oranı BOŞ — uydurma vergi yok) → taslak satırında **sağa hizalı ₺1.250,50 + vergi '—'** → Gönder → Onay Bekliyor → **Onayla** → Onaylandı + onaylayan bilgisi
  - Faz 08 hakediş akışı: API ile 1. hakediş onaylanır (zincir kökü, 200×245.75=49150.00) → UI'da 2. hakediş taslağı (önceki 200, dönem 150, kesinti 2500) → satırda **₺34.362,50 net** → **Önizle**: formül açıklaması + snapshot fiyat + NET 34.362,50 → Gönder → **Onayla** → API düzeyinde kalem fiyatı 999'a çekilir → **onaylı hakediş snapshot'ı 245.75 / 49150.00 değişmez** → API düzeyinde kesinti > brüt → **400**
- Ekran görüntüleri: `docs/screenshots/phase-08-giderler-taslak.png`, `phase-08-giderler-onayli.png`, `phase-08-hakedisler.png`

### Kalite kapıları

| Kapı | contracts | api | web | mobile | web-e2e |
| --- | --- | --- | --- | --- | --- |
| lint | ✅ | ✅ | ✅ | ✅ | (n/a) |
| typecheck | ✅ | ✅ | ✅ | ✅ | ✅ |
| build | ✅ | ✅ | ✅ (route: `/giderler`, `/hakedisler`) | (expo bundle CI kapsamı dışı) | — |
