# Langkah 1 — Audit Mockup, Aplikasi, dan Kontrak API

Tanggal audit: 14 September 2026
Status: selesai
Cakupan: Regular Market PTBAE-IND; Auction, Negotiated Market, dan Marketplace tetap di luar scope.

## 1. Tujuan

Langkah ini memetakan desain pada `regular-market-mockup` ke aplikasi React/NestJS/PostgreSQL yang sudah berjalan. Mockup diperlakukan sebagai referensi visual dan skenario, bukan sebagai pengganti domain engine atau sumber aturan resmi.

Sasaran audit:

- menentukan komponen mockup yang dapat langsung dihubungkan ke API yang ada;
- menemukan kontrak API atau model data yang belum mencukupi;
- memastikan pemisahan antara vintage unit dan target compliance period;
- menetapkan urutan aman untuk refactor UI tanpa merusak engine yang sudah lulus tes; dan
- membekukan batas scope sebelum implementasi berikutnya.

## 2. Baseline yang Diverifikasi

| Area | Keadaan saat audit |
|---|---|
| Backend | NestJS, modul position, orders/matching, market data, settlement/SRUK, governance, scenario, dan platform |
| Frontend | React/Vite, seluruh fungsi berada terutama di satu `App.tsx`, belum menggunakan page router |
| Database | PostgreSQL dengan migration 001–009 dan seed sintetis 2024–2026 |
| Authentication | API key dengan role `ADMIN`, `AUDITOR`, `MARKET_OPERATOR`, `SETTLEMENT_OPERATOR`, `TRADER`, `UAT_OPERATOR` |
| Automated tests | Type-check lulus; 10 backend suites dan 78 tests lulus |
| Frontend tests | Belum ada test file; perintah test lulus karena `--passWithNoTests` |
| Data sintetis | 42 peserta × 3 periode = 126 posisi; data bukan data resmi |
| UI deployment | Satu layar panjang; sudah terhubung ke API live |

## 3. Perbedaan Domain yang Paling Penting

### 3.1 Keadaan sekarang

Kunci utama transaksi dan saldo saat ini adalah:

```text
participant + seriesCode + compliancePeriod
```

Tabel posisi menyimpan `eligible_banked_units` sebagai satu angka agregat. Order, trade, settlement, registry message, reconciliation, dan ledger hanya membawa `series_code` serta `compliance_period`.

Konsekuensinya, sistem belum dapat membedakan contoh berikut:

```text
PTBAE-IND Vintage 2024 -> digunakan untuk CP-2027
PTBAE-IND Vintage 2025 -> digunakan untuk CP-2027
PTBAE-IND Vintage 2026 -> digunakan untuk CP-2027
```

Ketiganya saat ini akan terlihat sebagai saldo/order CP-2027 tanpa lineage tahun asal unit.

### 3.2 Model target yang disepakati

Vintage dan compliance period harus menjadi dua dimensi yang terpisah:

```text
participant
  + installation
  + seriesCode
  + vintageYear
  + targetCompliancePeriod
```

Aturan minimum yang harus diberlakukan:

1. Setiap holding dan perpindahan unit membawa `vintageYear`.
2. Setiap order membawa `vintageYear` dan `targetCompliancePeriod`.
3. Order book dan trigger book dipartisi setidaknya berdasarkan `seriesCode + vintageYear + marketSegment`.
4. Cross-vintage matching ditolak secara default.
5. Eligibility vintage terhadap compliance period diperiksa dari ruleset/product admission.
6. Banking, expiry, dan fungibility disimpan sebagai aturan eksplisit dan diberi label `SIMULATION_ASSUMPTION` sampai sumber resmi dikonfirmasi.
7. Settlement, pesan SRUK, reconciliation, ledger, dan audit mempertahankan lineage vintage.
8. Posisi kepatuhan hanya menghitung holding vintage yang eligible untuk target period.

Data sintetis 2024–2026 yang sudah ada tetap berguna sebagai input posisi tahunan, tetapi belum boleh dianggap sebagai ledger holding per vintage. Tahap model data berikutnya perlu mengubah banked aggregate menjadi provenance yang dapat ditelusuri.

## 4. Pemetaan Halaman Mockup ke Sistem

| Halaman mockup | API/domain yang sudah ada | Status | Gap utama |
|---|---|---|---|
| Dashboard | market-data snapshot, positions, market session, alerts | Sebagian siap | Ringkasan peserta/installation/vintage belum ada |
| Pasar Reguler | order book, trigger book, current ruleset, positions, submit order | Sebagian siap | Ticket belum membawa installation dan vintage; belum ada endpoint validate-only |
| Orders | `GET /orders`, `GET /orders/:id`, cancel | Siap dasar | Filter/status/history UI dan vintage lineage belum ada |
| Trades | `GET /trades`, `GET /trades/:id`, market data | Siap dasar | Vintage, installation, fee, dan tampilan detail lineage belum ada |
| Scenario Lab | create/run/replay/compare scenario | Sebagian siap | Seed hanya LIMIT sederhana; belum mendukung tipe MARKET/STOP, vintage, settlement lifecycle, atau katalog M-06/M-17/M-18/M-30/M-31/M-32 |
| Positions | list/detail positions 2024–2027 | Siap untuk posisi tahunan | Holding per vintage, eligibility matrix, dan installation belum ada |
| Settlement | create/process/fail/retry/reverse | Siap domain dasar | UI perlu menampilkan tahapan dan vintage; query masih per compliance period |
| SRUK & Reconciliation | send/ack/reject/retry/resolve | Siap domain dasar | SRUK masih adapter simulasi; payload tidak membawa vintage/installation |
| Participants | posisi dapat mengidentifikasi peserta | Belum lengkap | Belum ada CRUD/query participant dan installation khusus |
| Product & Series | tabel product series dan compliance periods | Belum diekspos penuh | Belum ada API product admission, vintage catalogue, eligibility/fungibility |
| Ruleset | list/detail/create/update/approve/activate | Siap dasar | Belum mengatur banking, expiry, vintage eligibility, cross-vintage policy |
| Surveillance | `GET /surveillance-alerts` | Read-only siap | Detail/resolve workflow dan vintage context belum ada |
| Audit Trail | `GET /audit-events` | Read-only siap | UI filter/detail tersedia terbatas; vintage perlu ikut payload |

## 5. Inventaris Kontrak API Saat Ini

### Position dan balance

- `GET /positions`
- `GET /positions/:participantId`
- `POST /balance-reservations/sell`
- `POST /balance-reservations/buy`
- `DELETE /balance-reservations/:reservationId`

### Order, matching, dan trade

- `POST /orders`
- `GET /orders`
- `GET /orders/:orderId`
- `DELETE /orders/:orderId`
- `POST /orders/expire-day`
- `GET /order-book`
- `GET /trigger-book`
- `POST /trigger-book/evaluate`
- `GET /trigger-events`
- `GET /trigger-events/:triggerEventId`
- `GET /trades`
- `GET /trades/:tradeId`

### Market data

- `GET /market-data/snapshot`
- `GET /market-data/events`
- `GET /market-data/replay`

### Settlement dan SRUK

- `POST /settlements/from-trade/:tradeId`
- `GET /settlements`
- `GET /settlements/:settlementId`
- `POST /settlements/:settlementId/process|fail|retry|reverse`
- `POST /registry/messages/:registryMessageId/send|acknowledge|reject|retry`
- `POST /reconciliations/:reconciliationId/resolve`

### Ruleset, operasi, dan audit

- `GET /rulesets` dan `GET /rulesets/:rulesetId`
- `POST /rulesets`, `PUT /rulesets/:rulesetId`
- `POST /rulesets/:rulesetId/approve|activate`
- `GET /market-sessions/:sessionId`
- `POST /market-sessions/:sessionId/open|halt|resume|close`
- `GET /audit-events`
- `GET /surveillance-alerts`

### Scenario

- `POST /scenarios`
- `GET /scenarios` dan `GET /scenarios/:scenarioId`
- `POST /scenarios/:scenarioId/run`
- `POST /scenarios/:scenarioId/replay/:runId`
- `GET /scenarios/runs/:runId`
- `GET /scenarios/runs/:runId/export`
- `POST /scenarios/runs/compare`

Semua path berada di bawah `/api/v1`.

## 6. Kontrak Tambahan yang Dibutuhkan

Sebelum mockup dapat menjadi UI operasional penuh, backend memerlukan kemampuan berikut:

1. Product catalogue dan admission query untuk daftar vintage, status, masa berlaku, serta eligibility.
2. Installation model dan pemetaan participant–installation–trader scope.
3. Holding/lot ledger per vintage, bukan hanya `eligible_banked_units` agregat.
4. `vintageYear`, `sourceInstallationId`, `beneficiaryInstallationId`, dan `targetCompliancePeriod` pada alur order-to-settlement.
5. Endpoint pre-trade validation/preview yang tidak membuat reservation atau order.
6. Filter/pagination yang konsisten untuk orders, trades, settlements, audit, dan alerts.
7. Scenario schema versi baru yang menerima LIMIT/MARKET/STOP, vintage, protection, trigger, settlement, dan expected assertions.
8. Participant/product/installation query API untuk dropdown dan halaman master data.

Perubahan tersebut harus diperkenalkan melalui migration maju dan kontrak API yang tetap kompatibel selama transisi UI.

## 7. Keputusan Integrasi UI

- Visual shell, navigasi, hierarchy, badge, panel, tabel, dan responsive behavior dari mockup digunakan sebagai referensi desain.
- Engine JavaScript dalam mockup tidak dipindahkan ke production karena backend NestJS/PostgreSQL adalah system of record.
- Tombol `Submit / Run` pada mockup dipisahkan menjadi aksi nyata: `Validate Order`, `Submit Order`, dan `Reset`.
- Trigger book hanya menampilkan STOP order sesuai hak akses dan tidak pernah masuk visible market depth sebelum aktivasi.
- Reference price tidak ditampilkan sebagai LTP ketika belum ada trade; status tetap `NO_TRADES`.
- Settlement dan SRUK ditampilkan sebagai lifecycle bertahap, bukan auto-complete tersembunyi.
- Scenario Lab berjalan pada konteks UAT terisolasi agar tidak mencampur data pasar aktif.
- API key tetap disimpan hanya di session browser untuk prototype; IAM/OIDC tetap persyaratan sebelum produksi nyata.

## 8. Prioritas Gap

### P0 — harus selesai sebelum ticket baru diaktifkan

- model vintage terpisah dari compliance period;
- installation dan beneficiary/source lineage;
- product admission serta eligibility vintage;
- isolasi book/matching per vintage;
- propagasi vintage sampai settlement/SRUK/reconciliation/audit.

### P1 — dibutuhkan untuk kesetaraan fungsi mockup

- shell dan routing halaman;
- validate-only order endpoint;
- filter/detail Orders, Trades, Settlement, dan Audit;
- staged SRUK controls;
- scenario catalogue enam skenario referensi.

### P2 — peningkatan operasional

- pagination dan export yang konsisten;
- workflow penanganan surveillance alert;
- test UI, accessibility, serta responsive regression;
- IAM/OIDC, managed secrets, observability terpusat, dan hardening produksi.

## 9. Risiko dan Guardrail

| Risiko | Guardrail |
|---|---|
| Tahun posisi disalahartikan sebagai vintage | Gunakan nama field berbeda dan jangan melakukan fallback implisit |
| Banked unit tanpa asal tahun | Migration membentuk holding/lot lineage; aggregate lama hanya data transisi |
| Cross-vintage match tidak sengaja | Fungibility key menjadi bagian dari partition dan matching predicate |
| Aturan simulasi dianggap resmi | Tampilkan badge dan simpan `policySource/certainty` pada admission/ruleset |
| Refactor UI mengubah hasil engine | Pertahankan API tests, golden scenario, dan tambahkan contract tests |
| Trader bertindak untuk installation lain | Validasi participant serta installation scope di server, bukan hanya dropdown UI |
| Data UAT bercampur dengan live demo | Namespace/session/dataset context terpisah dan reset terkontrol |

## 10. Hasil dan Exit Criteria Langkah 1

Langkah 1 dinyatakan selesai karena:

- seluruh halaman mockup telah dipetakan ke domain/API;
- baseline buildability telah diperiksa melalui type-check dan tests;
- gap antara vintage dan compliance period telah diidentifikasi secara eksplisit;
- kebutuhan kontrak tambahan telah diprioritaskan;
- keputusan integrasi UI dan batas scope telah dibekukan; dan
- tidak ada perubahan perilaku aplikasi yang dilakukan selama audit.

## 11. Rekomendasi Langkah Berikutnya

Langkah 2 harus dimulai dari desain dan implementasi model domain berikut:

```text
ProductSeries
QuotaVintage
ProductAdmission
CompliancePeriod
Participant
Installation
TraderScope
VintageHolding / VintageLedger
VintageEligibilityRule
```

Migration dan kontrak API harus diselesaikan serta diuji terlebih dahulu sebelum halaman React baru mengirim order yang membawa vintage. Dengan urutan ini, tampilan baru tidak dibangun di atas arti tahun yang ambigu.
