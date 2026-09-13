# Rencana Pengembangan Simulator Regular Market PTBAE IND

## 1 Tujuan dan hasil akhir

Membangun simulator atau prototype Regular Market PTBAE-IND yang dapat:

1. menghitung hak jual dan kebutuhan beli dari posisi kepatuhan tahunan;
2. menerima order LIMIT, MARKET, dan STOP;
3. melakukan validasi, reservasi, matching, partial fill, dan multi-order fill secara deterministik;
4. membentuk Trade dan data pasar;
5. mensimulasikan settlement T+0 trade-for-trade DvP;
6. mengirim, menerima acknowledgement, dan merekonsiliasi transaksi dengan simulator SRUK;
7. memperbarui posisi kepatuhan hanya setelah finality yang dikonfigurasi; dan
8. menyediakan ruleset versioned, audit trail, replay skenario, serta kontrol operasional.

Prototype disarankan dibangun sebagai modular monolith dengan event log dan port-adapter untuk IAM, MRV, settlement, dan SRUK. Bentuk ini cukup sederhana untuk pengembangan bertahap, tetapi menjaga batas domain agar modul dapat dipisahkan apabila kebutuhan skala muncul.

## 2 Batas scope

### Dalam scope

- Satu mekanisme continuous Regular Market.
- Product series PTBAE-IND dan compliance period sebagai atribut terpisah.
- Posisi kepatuhan berbasis allocated quota dan verified emission.
- LIMIT, MARKET, dan STOP Order untuk sisi BUY dan SELL.
- Visible bid/ask book dan non-visible trigger book.
- Price-time priority dan harga eksekusi resting order sebagai default simulator.
- Reservation kuota dan buying capacity.
- Trade capture, LTP, VWAP, OHLCV, spread, dan depth.
- Settlement simulator, SRUK simulator/adapter, reconciliation, dan position update.
- Ruleset, market session, halt/resume, audit, idempotency, dan scenario replay.
- Integrasi read-only terhadap identity, role, permission, participant linkage, quota, dan verified emission dari sumber eksternal atau fixture.

### Di luar scope tahap ini

- Auction.
- Negotiated Market.
- Marketplace.
- Price discovery lintas mekanisme.
- Cross-series atau cross-period matching tanpa fungibility rule eksplisit.
- Trading berdasarkan projected emission.
- Integrasi production ke payment rail, SRUK, IAM, atau MRV nyata.
- High-frequency/ultra-low-latency exchange architecture.

## 3 Pemisahan aturan, default simulator, dan keputusan terbuka

Dokumen sumber adalah spesifikasi simulasi, bukan ketentuan pasar resmi. Karena itu, semua parameter operasional harus disimpan sebagai MarketRuleset yang memiliki version dan effective period.

| Parameter | Default prototype | Status |
|---|---:|---|
| Sell cap | Verified surplus conservative | Default simulator; perlu konfirmasi aturan sektor/operator |
| Trading sebelum verifikasi final | Tidak | Default simulator; perlu konfirmasi aturan sektor |
| Lot size | 1 unit | Configurable |
| Tick size | Rp200 | Configurable |
| Price band | ±20% reference price | Configurable |
| Matching priority | PRICE_TIME | Configurable/versioned |
| Execution price | RESTING_ORDER_PRICE | Configurable/versioned |
| MARKET time-in-force | IOC | Configurable |
| Market protection | Ceiling/floor atau max slippage wajib | Metode dan nilai harus ditetapkan ruleset |
| Stop trigger basis | LTP | Configurable |
| Stop direction | BUY ≥ stop price; SELL ≤ stop price | Configurable |
| Stop activation | MARKET | Configurable |
| Stop reservation | Sejak submission | Configurable |
| Settlement | T+0 trade-for-trade DvP | Default simulator; finality configurable |
| Banking/carry-over | Belum diasumsikan | Keputusan terbuka |
| Trading window dan surrender deadline | Calendar configuration | Keputusan terbuka |

Setiap Order, MatchEvent, Trade, Settlement, RegistryAcknowledgement, dan perhitungan posisi wajib menyimpan ruleset_version yang digunakan.

## 4 Model posisi dan saldo

### Formula inti

```text
GrossPosition = AllocatedQuota - VerifiedEmission

NetPosition = AllocatedQuota
            + AcknowledgedPurchases
            - AcknowledgedSales
            + EligibleBankedUnits
            + EligibleOffsetApplied
            - VerifiedEmission

MaxSellQuantity = min(
  PhysicalTradableAvailable,
  VerifiedSurplusRemaining
)

BuyNeedRemaining = max(
  0,
  VerifiedEmission
  - AllocatedQuota
  - AcknowledgedPurchases
  + AcknowledgedSales
  - EligibleBankedUnits
  - EligibleOffsetApplied
)
```

### Saldo yang harus dipisahkan

| Saldo | Makna | Kapan berubah |
|---|---|---|
| Physical Holding | Holding registry/local ledger yang sudah reconciled | Setelah registry acknowledgement/reconciliation |
| Reserved Sell | Kuota untuk SELL order aktif atau trigger-pending | Submit, partial fill, cancel, expire, reject |
| Available to Sell | Eligible holding dikurangi reserved, locked, dan surrendered | Derived setiap perubahan saldo |
| Reserved Buy Funds | Maximum exposure ditambah fee buffer | Submit, fill, cancel, expire, reject |
| Executed Pending Settlement | Trade executed tetapi belum final | Matching dan settlement lifecycle |
| Acknowledged Position | Posisi authoritative | Setelah finality yang ditentukan ruleset |

Validasi saldo dan pembuatan reservation harus atomik. Order paralel dari peserta yang sama tidak boleh memakai kuota atau buying capacity yang sama.

## 5 Arsitektur logis

| Bounded module | Tanggung jawab utama | Write owner |
|---|---|---|
| Reference and Access | Participant mirror, trader mapping, product, period, admission, permission context | Reference service |
| Compliance Position | Quota, verified emission, gross/net position, sell cap, buy need | Position service |
| Balance and Reservation | Holding mirror, cash capacity, reservation, pending settlement lock | Balance service |
| Order Management | Submission, validation, lifecycle, amend/cancel, idempotency | Order service |
| Visible Order Book | Bid/ask price levels dan time priority | Order book service |
| Trigger Book | STOP waiting entries, trigger evaluation, single activation | Trigger service |
| Matching | Candidate selection, price, executable quantity, atomic match | Matching engine |
| Trade and Market Data | Immutable trades, LTP, VWAP, OHLCV, depth | Trade/market data service |
| Settlement | Obligation legs, DvP workflow, failure/reversal state | Settlement service |
| SRUK and Reconciliation | Registry message, acknowledgement, retry, discrepancy case | SRUK adapter |
| Rules and Operations | Ruleset, sessions, halt/resume, reference price | Rules/admin service |
| Audit and Replay | Immutable audit/domain events, correlation chain, scenario replay | Audit service |

### Data store prototype

- PostgreSQL sebagai system of record untuk order, ledger, trade, settlement, reconciliation, ruleset, dan audit.
- In-memory order book dan trigger indexes untuk simulasi cepat; snapshot dan replay berasal dari database/event log.
- Transactional outbox untuk pengiriman event settlement, SRUK, market data, dan notifikasi tanpa kehilangan event.
- Logical clock atau deterministic event sequence untuk test dan replay; wall-clock tetap dicatat untuk audit.
- Simulator SRUK dan settlement harus menggunakan contract yang sama dengan adapter eksternal agar dapat diganti tanpa mengubah domain core.

## 6 Urutan pembangunan dan quality gate

### Tahap 1 Annual Position and Balance

**Tujuan:** Menentukan secara konsisten siapa yang dapat menjual, berapa maksimum jualnya, dan berapa kebutuhan beli peserta.

**Bangun:**

- ProductSeries, CompliancePeriod, ProductAdmission, Participant, QuotaHolding, AnnualCompliancePosition.
- Import/fixture allocated quota dan verified emission.
- Kalkulasi GrossPosition, NetPosition, MaxSellQuantity, BuyNeedRemaining.
- Balance ledger dan reservation primitive untuk asset/cash.
- Snapshot posisi: physical, available, reserved, executed-pending, acknowledged.
- API/query posisi peserta dan preview exposure.

**Gate:**

- Contoh A/B/C menghasilkan surplus 30.000/50.000/40.000; D menghasilkan defisit 60.000.
- Dua reservation simultan tidak dapat menyebabkan oversell/overbuy.
- Projected dan verified position tidak tercampur.
- Product series dan period selalu menjadi bagian dari key saldo.

### Tahap 2 LIMIT Order and Order Book

**Tujuan:** Memiliki jalur order paling sederhana yang sudah menguji validasi, reservasi, lifecycle, dan antrean.

**Bangun:**

- Order aggregate dan state machine LIMIT.
- Conditional validation untuk quantity, limit_price, TIF, tick, band, session, permission, eligibility, dan idempotency.
- Visible bid/ask book per series dan period.
- Price levels: BUY descending, SELL ascending; FIFO pada harga sama.
- Submit, cancel, expire, dan read-only depth/order views.

**Gate:**

- LIMIT tanpa harga dan MARKET/STOP fields pada LIMIT ditolak.
- Sell/buy reservation benar pada submit dan terlepas idempotently pada cancel/expire/reject.
- Queue price-time deterministik setelah restart/replay.
- Cross-series dan cross-period entry tidak pernah berada pada book yang sama.

### Tahap 3 Matching Engine

**Tujuan:** Menghasilkan match deterministik untuk full, partial, dan multi-order execution.

**Bangun:**

- Candidate selection dan executable quantity.
- Price compatibility untuk LIMIT.
- Resting order execution price.
- MatchEvent dan Trade creation.
- Atomic boundary: Trade + remaining quantity + order state + reservation delta + book delta.
- Self-match/prohibited-counterparty control dan market halt hook.

**Gate:**

- No match, 1:1 full fill, incoming partial, resting partial, multi-seller, multi-buyer, dan equal-price time priority lulus.
- Total executed quantity sama dengan jumlah trade quantity.
- Tidak ada overfill, double release, atau trade tanpa reservation delta.
- Skenario BUY LIMIT 60.000 menghasilkan 30.000 @ Rp75.000 dan 30.000 @ Rp76.000; ask Rp78.000 tidak tersentuh.

### Tahap 4 MARKET Order

**Tujuan:** Menyapu best available liquidity dengan protection dan remainder policy yang eksplisit.

**Bangun:**

- MARKET field rules; tidak menerima user limit_price.
- Protection ceiling/floor atau max slippage policy.
- Maximum notional dan fee buffer reservation.
- IOC baseline dan CANCELLED_REMAINDER.
- Empty book, insufficient depth, changing depth, dan insufficient funds handling.

**Gate:**

- Tidak ada trade di luar protection aktif.
- BUY MARKET 60.000 pada contoh menghasilkan 30.000 @ Rp75.000, 20.000 @ Rp76.000, dan 10.000 @ Rp78.000.
- Bila depth hanya 50.000, 50.000 dieksekusi dan 10.000 menjadi CANCELLED_REMAINDER.
- Unused protection/fee buffer dilepas tepat sekali.

### Tahap 5 STOP and Trigger Book

**Tujuan:** Memisahkan conditional order dari visible liquidity dan mengaktifkannya tepat satu kali.

**Bangun:**

- STOP state machine dan non-visible TriggerBookEntry.
- stop_price, trigger_basis, direction, activation_type, expiry, dan protection.
- Market-data subscription dan trigger evaluation.
- Single-use trigger token/idempotent activation.
- Baseline STOP to MARKET; extensible ke STOP to LIMIT bila ruleset mengaktifkan.

**Gate:**

- STOP tidak muncul di bid/ask depth sebelum trigger.
- BUY trigger pada LTP ≥ stop_price; SELL trigger pada LTP ≤ stop_price.
- Duplicate ticks/events tidak menyebabkan aktivasi ganda.
- Cancel/expire sebelum trigger melepaskan reservation dan mencegah aktivasi.
- Source trade, observed LTP, trigger timestamp, TriggerEvent ID, activated order ID, dan Trade IDs memiliki correlation chain.

### Tahap 6 Trade and Market Data

**Tujuan:** Membuat trade ledger immutable dan data pasar yang dapat direkonstruksi.

**Bangun:**

- Trade dan TradeLeg yang immutable; koreksi melalui event baru, bukan overwrite.
- Best bid, best ask, spread, LTP, VWAP, OHLCV, volume, dan depth per series/period/session.
- No-trade state yang eksplisit; reference price tidak disamakan dengan LTP.
- Market data snapshot, stream, dan scenario replay.

**Gate:**

- Semua statistik dapat direproduksi dari accepted trade/book events.
- VWAP = Σ(price × qty) / Σqty untuk window yang ditentukan.
- STOP belum aktif tidak masuk depth.
- Tidak ada LTP/VWAP sintetis pada sesi tanpa trade.

### Tahap 7 Settlement and SRUK

**Tujuan:** Memisahkan trade execution dari ownership final dan memperbarui posisi hanya setelah finality.

**Bangun:**

- SettlementInstruction dengan cash leg dan unit leg.
- T+0 trade-for-trade DvP simulator.
- Settlement states: PENDING, PROCESSING, SETTLED, FAILED, REVERSED.
- Registry message states: QUEUED, SENT, ACKNOWLEDGED, REJECTED, RETRY.
- Reconciliation antara trade ledger, settlement ledger, local quota ledger, dan registry response.
- Exception case, manual resolve/retry simulator, registry reference uniqueness.
- Position update setelah ACKNOWLEDGED/RECONCILED sesuai ruleset.

**Gate:**

- Trade EXECUTED tidak mengubah physical holding atau acknowledged position.
- Retry settlement/SRUK tidak membuat transfer atau acknowledgement ganda.
- Settlement failure tidak dianggap acknowledged dan tidak diam-diam mengubah holding.
- Setelah full acknowledgement skenario LIMIT: A = 0, B = +20.000, C = +40.000, D = 0.
- Semua delta posisi dapat ditelusuri ke Trade, Settlement, RegistryAcknowledgement, dan ruleset version.

### Tahap 8 Ruleset Admin and Audit

**Tujuan:** Menjadikan simulator dapat dikonfigurasi, diaudit, diulang, dan dioperasikan tanpa perubahan kode untuk setiap parameter.

**Bangun:**

- MarketRuleset versioning, effective dating, draft/approve/activate lifecycle.
- Admin untuk tick, lot, band, TIF, protection, trigger, session, sell cap, dan settlement finality.
- Market open/close/halt/resume.
- Immutable AuditEvent: actor, permission context, before/after, timestamp, correlation ID, causation ID.
- Scenario seed, event timeline, replay, export result, dan comparison report.
- Basic surveillance alerts: self-match, unusual price/volume, repeated cancel, trigger anomaly.

**Gate:**

- Order dan trade lama tetap dapat dijelaskan memakai ruleset version historis.
- Ruleset aktif tidak dapat diedit in place.
- Halt menghentikan matching baru secara konsisten tanpa merusak reservation.
- Full scenario dapat direplay dengan hasil trade dan event sequence yang sama.
- Correlation chain lengkap dari command sampai position update.

## 7 Alur transaksi end to end

1. User existing IAM dipetakan ke participant, trader account, installation, role, dan permission.
2. Product PTBAE-IND, compliance period, admission, session, dan ruleset aktif dipilih.
3. Order Ticket membentuk command berdasarkan LIMIT, MARKET, atau STOP.
4. Pre-trade validation memeriksa akses, status peserta, product/period, session, fields, lot/tick/band, balance, exposure, controls, protection, dan idempotency.
5. Balance service membuat reservation atomik.
6. LIMIT masuk visible book; MARKET langsung ke matching; STOP masuk trigger book.
7. Matching menghasilkan satu atau lebih MatchEvent dan Trade pada harga resting order sesuai ruleset.
8. Trade, order deltas, reservation deltas, dan market data events di-commit sebagai satu unit konsistensi.
9. SettlementInstruction diproses; SRUK adapter mengirim request/event dan menerima acknowledgement.
10. Reconciliation membandingkan seluruh ledger dan registry state.
11. Setelah finality, holding dan annual compliance position diperbarui; hasil dapat direplay dari audit/event trail.

## 8 API minimum

### Commands

- `POST /orders`
- `POST /orders/{id}/cancel`
- `POST /orders/{id}/expire` untuk simulator/admin clock
- `POST /market-sessions/{id}/open|halt|resume|close`
- `POST /market-data/ticks` untuk scenario driver
- `POST /settlements/{id}/process|fail|reverse|retry`
- `POST /registry/messages/{id}/acknowledge|reject|retry`
- `POST /reconciliations/{id}/resolve`
- `POST /rulesets/{id}/activate`
- `POST /scenarios/{id}/run|replay`

### Queries

- `GET /participants/{id}/positions?period=...`
- `GET /participants/{id}/balances?series=...&period=...`
- `GET /orders/{id}` dan `GET /orders`
- `GET /order-book?series=...&period=...`
- `GET /trigger-book` khusus role berizin
- `GET /trades` dan `GET /trades/{id}`
- `GET /market-data/snapshot`
- `GET /settlements/{id}`
- `GET /reconciliations`
- `GET /audit-events?correlation_id=...`
- `GET /scenarios/{id}/result`

Setiap command mutating menerima `idempotency_key`; order submission juga menerima `client_order_id` yang unik per participant.

## 9 Status dan correlation model

```text
LIMIT
DRAFT -> SUBMITTED -> VALIDATED -> OPEN <-> PARTIALLY_FILLED -> FILLED
terminal: REJECTED | CANCELLED | EXPIRED | BLOCKED

MARKET
DRAFT -> SUBMITTED -> VALIDATED -> OPEN -> PARTIALLY_FILLED/FILLED
terminal: REJECTED | CANCELLED_REMAINDER | BLOCKED

STOP
DRAFT -> SUBMITTED -> VALIDATED -> TRIGGER_PENDING -> TRIGGERED
      -> ACTIVATED -> OPEN/PARTIALLY_FILLED/FILLED
terminal: REJECTED | CANCELLED | EXPIRED | BLOCKED | ACTIVATION_FAILED

POST TRADE
Trade: EXECUTED -> CONFIRMED -> SENT_FOR_SETTLEMENT
Settlement: PENDING -> PROCESSING -> SETTLED | FAILED | REVERSED
Registry: QUEUED -> SENT -> ACKNOWLEDGED | REJECTED | RETRY
Reconciliation: OPEN -> MATCHED | EXCEPTION -> RESOLVED
```

`order_id`, `trigger_event_id`, `match_event_id`, `trade_id`, `settlement_id`, `registry_reference`, dan `reconciliation_id` adalah ID berbeda. Hubungannya dijaga dengan `correlation_id` dan `causation_id`.

## 10 Strategi pengujian

### Lapisan pengujian

- Unit/property tests untuk formula posisi, price-time ordering, executable quantity, protection, dan state transition.
- Transaction/concurrency tests untuk reservation, matching, cancel-vs-fill, duplicate activation, dan retry.
- Contract tests untuk IAM/MRV/SRUK/settlement ports.
- Golden scenario tests untuk seluruh contoh LIMIT, MARKET, dan STOP.
- Event replay tests untuk memastikan state dan statistik dapat direkonstruksi.
- Failure injection untuk SRUK timeout, duplicate acknowledgement, settlement failure, database retry, dan outbox retry.

### Catalogue minimum

- LIMIT: no match, full, incoming partial, resting partial, multi-seller, multi-buyer, equal price/time priority, price boundary.
- MARKET: full multi-level, insufficient depth, protection reached, empty book, insufficient funds, concurrent depth changes.
- STOP: below trigger, exact threshold, gap, cancel before trigger, expire before trigger, duplicate market-data event.
- Shared: wrong product/period, insufficient quota, self-match, halt, settlement failure, SRUK timeout/retry.

## 11 Deliverable per tahap

Setiap tahap selesai hanya jika menghasilkan:

- domain model dan migration;
- API/command-query contract;
- UI atau simulator control yang relevan;
- event schema dan audit fields;
- unit, integration, dan golden scenario tests;
- sample fixtures A/B/C/D;
- trace/correlation view;
- README berisi ruleset version dan keterbatasan tahap tersebut; dan
- demo script yang dapat dijalankan ulang secara deterministik.

## 12 Definition of Done prototype

Prototype dinyatakan lengkap ketika:

1. ketiga jenis order dapat dibuat untuk BUY dan SELL dengan field conditional yang benar;
2. semua hak jual/beli berasal dari position dan balance service, bukan input bebas;
3. LIMIT, MARKET, dan activated STOP mengikuti protection serta menghasilkan full/partial/multi-order outcomes yang benar;
4. STOP tidak terlihat sebelum trigger dan tidak dapat diaktivasi dua kali;
5. trade ledger, market data, reservation, dan order states selalu dapat direkonsiliasi;
6. settlement dan SRUK retry bersifat idempotent;
7. posisi authoritative hanya berubah setelah finality yang dikonfigurasi;
8. scenario A/B/C menghasilkan angka contoh yang sama dengan dokumen sumber;
9. semua aksi memiliki actor, timestamp, permission context, ruleset version, correlation ID, dan causation ID; dan
10. tidak ada endpoint atau modul untuk Auction, Negotiated Market, atau Marketplace pada release ini.

## 13 Urutan pekerjaan pertama

1. Bekukan glossary dan decision register default simulator.
2. Definisikan schema ProductSeries, CompliancePeriod, AnnualCompliancePosition, QuotaHolding, dan BalanceReservation.
3. Buat fixtures A/B/C/D dan test formula posisi.
4. Implementasikan reservation atomik beserta concurrency tests.
5. Definisikan Order aggregate dan LIMIT state machine.
6. Bangun visible order book dan deterministic price-time queue.
7. Implementasikan matching transaction boundary dan golden LIMIT scenario.
8. Lanjutkan ke MARKET, STOP, market data, settlement/SRUK, lalu ruleset/admin/audit sesuai quality gate di atas.
