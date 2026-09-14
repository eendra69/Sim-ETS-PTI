# Simulator Regular Market PTBAE IND

Prototype untuk menghitung posisi kepatuhan tahunan dan mensimulasikan perdagangan PTBAE-IND melalui Regular Market. Scope release ini hanya mencakup LIMIT, MARKET, dan STOP Order. Auction, Negotiated Market, dan Marketplace tidak termasuk.

## Status

Tahap 1 sampai 8 telah lolos gate dan Tahap 9 menyediakan release gate UAT/staging. Prototype saat ini mencakup:

- monorepo TypeScript dengan NestJS API dan React web;
- formula posisi tahunan, batas jual, dan kebutuhan beli;
- saldo kuota, buying capacity, dan reservasi atomik di PostgreSQL;
- fixture Industri A, B, C, dan D untuk periode 2027;
- PostgreSQL schema dan seed data;
- Docker Compose untuk database lokal;
- unit serta integration tests;
- LIMIT BUY/SELL dengan validasi ruleset, tick, band, lot, dan idempotency;
- reservasi otomatis saat submit serta release saat cancel/expire;
- visible bid/ask book berprioritas harga-waktu;
- persistence order dan antrean deterministik di PostgreSQL;
- matching otomatis berdasarkan price-time priority;
- harga eksekusi mengikuti resting order;
- full fill, partial fill, dan multi-order fill;
- pencegahan self-match;
- trade dan match-event ledger yang immutable;
- pemindahan reservation ke executed-pending secara atomik saat matching;
- MARKET BUY/SELL dengan protection ceiling/floor wajib;
- IOC multi-level sweep tanpa menempatkan MARKET ke visible book;
- `CANCELLED_REMAINDER` serta pelepasan reservation yang tidak terpakai;
- STOP BUY/SELL non-visible dengan trigger LTP;
- reservasi sejak submission serta release saat cancel/expire;
- aktivasi tepat satu kali menjadi protected MARKET IOC;
- correlation chain dari source trade ke TriggerEvent, activated order, dan trade hasil aktivasi;
- immutable BUY/SELL TradeLeg untuk setiap trade;
- explicit `NO_TRADES` state yang memisahkan reference price dari LTP;
- best bid, best ask, spread, depth, LTP, volume, notional, VWAP, dan OHLC;
- statistik berbasis trade-sequence window;
- resumable trade-event feed dan deterministic replay.
- SettlementInstruction T+0 trade-for-trade DvP dengan cash dan unit obligation;
- lifecycle settlement `PENDING`, `PROCESSING`, `SETTLED`, `FAILED`, dan `REVERSED`;
- lifecycle pesan SRUK `QUEUED`, `SENT`, `ACKNOWLEDGED`, `REJECTED`, dan `RETRY`;
- reconciliation `OPEN`, `MATCHED`, `EXCEPTION`, dan manual `RESOLVED`;
- finalisasi holding, buying capacity, dan acknowledged compliance position secara atomik;
- immutable settlement ledger dengan dua unit legs dan dua cash legs; serta
- idempotency command dan registry-reference uniqueness untuk mencegah double transfer;
- ruleset versioned dengan lifecycle `DRAFT`, `APPROVED`, `ACTIVE`, dan `RETIRED`;
- effective dating serta satu ruleset aktif per seri dan periode;
- session control `OPEN`, `HALTED`, dan `CLOSED` tanpa merusak reservation;
- audit event append-only dengan actor, permission context, before/after state, correlation, dan causation;
- alert surveillance dasar untuk self-match, harga/volume tidak biasa, repeated cancel, dan trigger anomaly; serta
- deterministic scenario run, replay, export, dan comparison.
- UAT end-to-end berbasis 42 posisi sintetis `VERIFIED` tahun 2025;
- provenance posisi serta pencegahan hak jual dari posisi `PROVISIONAL` 2026;
- API-key RBAC dan participant scope untuk trader;
- identity-bound admin audit, correlation ID, structured request log, rate limit, security headers;
- liveness, PostgreSQL readiness, metrik Prometheus, CI PostgreSQL, dan backup/restore runbook.

Default simulator bukan ketentuan pasar resmi. Parameter market harus dibaca dari MarketRuleset versioned.

## Menjalankan lokal

Prasyarat: Node.js 22+, pnpm, dan Docker Desktop.

```bash
Copy-Item .env.example .env
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed:synthetic
pnpm dev
```

`PERSISTENCE_MODE=postgres` adalah mode lokal normal. Test otomatis memakai fixture in-memory yang terisolasi agar cepat dan deterministik.

API tersedia di `http://localhost:3000/api/v1` dan web di `http://localhost:5173`.

## Perintah

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm data:generate:synthetic
pnpm data:validate:synthetic
pnpm db:up
pnpm db:migrate
pnpm db:seed:synthetic
pnpm uat:synthetic
pnpm db:down
```

## Dataset sintetis 2024–2026

Dataset UAT deterministik tersedia di `data/synthetic`. Isinya mencakup 42 peserta anonim dari tujuh arketipe usaha dan 126 posisi tahunan. Data 2024–2025 berstatus `VERIFIED` sintetis, sedangkan 2026 berstatus `PROVISIONAL`. Seluruh record memiliki provenance `SYNTHETIC`, source reference unik, dan hash dataset.

## Katalog vintage dan instalasi

Model katalog memisahkan tahun asal unit (`vintageYear`) dari periode kepatuhan tujuan (`targetCompliancePeriod`). Vintage 2024–2026 dan seed simulasi 2027 memiliki product admission serta fungibility key tersendiri; cross-vintage matching dinonaktifkan. Aturan banking/eligibility yang belum bersumber dari ketentuan resmi selalu diberi `policyCertainty: SIMULATION_ASSUMPTION`.

Holding sintetis per vintage diturunkan hanya dari surplus bruto tahun asal. Nilai agregat `eligible_banked_units` tidak ditebak asal tahunnya dan tidak dimaterialisasi sebagai holding vintage. Holding dengan sumber `PROVISIONAL`, termasuk data sintetis 2026, memiliki `tradableAvailableUnits: 0` walaupun vintage produknya eligible untuk periode tujuan.

Endpoint baca katalog:

- `GET /api/v1/product-series`
- `GET /api/v1/quota-vintages?seriesCode=PTBAE-IND&targetCompliancePeriod=2027`
- `GET /api/v1/quota-vintages/:vintageId?targetCompliancePeriod=2027`
- `GET /api/v1/product-admissions?seriesCode=PTBAE-IND&vintageYear=2026`
- `GET /api/v1/vintage-eligibility?seriesCode=PTBAE-IND&vintageYear=2024&targetCompliancePeriod=2027`
- `GET /api/v1/installations?participantId=IND-D`
- `GET /api/v1/trader-installation-scopes?participantId=IND-D`
- `GET /api/v1/vintage-holdings?participantId=IND-D&seriesCode=PTBAE-IND&targetCompliancePeriod=2027`

Kontrak order/trade lama masih menggunakan `compliancePeriod` untuk menjaga kompatibilitas. Propagasi `vintageYear` dan installation lineage ke matching serta settlement dilakukan pada lapisan implementasi berikutnya; UI baru belum boleh menganggap tahun periode sebagai vintage secara implisit.

Generator menghasilkan master peserta, input kepatuhan, expected result, negative test cases, ringkasan kontrol, serta SQL seed. Menjalankan seed berulang kali tidak menggandakan record, menaikkan version tanpa perubahan, atau menimpa saldo transaksi yang sudah aktif.

```bash
pnpm data:generate:synthetic
pnpm data:validate:synthetic
pnpm db:migrate
pnpm db:seed:synthetic
```

Dataset ini hanya untuk pengembangan dan UAT. Angkanya bukan kuota, emisi, atau saldo registry resmi.

## Endpoint Tahap 1

- `GET /api/v1/health`
- `GET /api/v1/positions?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `GET /api/v1/positions/:participantId?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `POST /api/v1/balance-reservations/sell`
- `POST /api/v1/balance-reservations/buy`
- `DELETE /api/v1/balance-reservations/:reservationId`

## Endpoint Tahap 2

- `GET /api/v1/market-rulesets/current`
- `POST /api/v1/orders`
- `GET /api/v1/orders?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `GET /api/v1/orders/:orderId`
- `DELETE /api/v1/orders/:orderId`
- `POST /api/v1/orders/expire-day?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `GET /api/v1/order-book?seriesCode=PTBAE-IND&compliancePeriod=2027`

Baseline ruleset prototype: reference price Rp75.000, price band Rp60.000–Rp90.000, tick Rp200, dan lot 1 tCO2e. Parameter ini bukan ketentuan pasar resmi. Admin dapat membuat versi pengganti, mengubahnya selama masih `DRAFT`, lalu approve dan activate tanpa mengubah kode.

## Endpoint Tahap 3

- Matching otomatis dijalankan oleh `POST /api/v1/orders`.
- `GET /api/v1/trades?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `GET /api/v1/trades/:tradeId`

Trade berstatus `EXECUTED` belum mengubah physical holding atau acknowledged compliance position. Kuantitas dan dana dipindahkan ke executed-pending sampai tahap Settlement/SRUK diselesaikan.

## Tahap 4 MARKET Order

MARKET memakai endpoint submission yang sama, `POST /api/v1/orders`, dengan `orderType: "MARKET"`, `timeInForce: "IOC"`, dan `protectionPrice`. MARKET tidak menerima `limitPrice`. Untuk BUY, protectionPrice adalah harga maksimum; untuk SELL, protectionPrice adalah harga minimum.

Jika depth habis atau protection tercapai, bagian yang sempat terisi tetap menjadi trade dan sisa quantity berstatus `CANCELLED_REMAINDER`. MARKET yang tidak menghasilkan trade juga berakhir dengan status tersebut dan tidak masuk order book.

## Tahap 5 STOP/Trigger Book

STOP memakai `POST /api/v1/orders` dengan `orderType: "STOP"`, `stopPrice`, `protectionPrice`, `triggerBasis: "LTP"`, `activationType: "MARKET"`, serta TIF `DAY` atau `GTC`. BUY aktif saat LTP ≥ stopPrice; SELL aktif saat LTP ≤ stopPrice. Protection BUY harus sama dengan atau lebih tinggi dari stop price, sedangkan protection SELL harus sama dengan atau lebih rendah.

STOP berstatus `TRIGGER_PENDING` tidak terlihat di bid/ask depth, tetapi saldo sudah direservasi sejak submission. Setelah terpicu, sistem membuat child MARKET IOC tepat satu kali. Cancel atau expiry sebelum trigger melepaskan reservasi dan mencegah aktivasi.

- `GET /api/v1/trigger-book?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `POST /api/v1/trigger-book/evaluate` untuk replay idempotent berdasarkan `sourceTradeId`
- `GET /api/v1/trigger-events?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `GET /api/v1/trigger-events/:triggerEventId`

## Tahap 6 Trade/Market Data

Setiap trade memiliki BUY dan SELL TradeLeg dengan unit serta cash delta yang seimbang. Market-data dibentuk ulang dari immutable trade ledger dan current visible order book; STOP pending tidak ikut depth. Dalam sesi tanpa trade, `state` adalah `NO_TRADES`, sedangkan LTP, VWAP, dan OHLC bernilai `null`. Reference price tetap tersedia sebagai parameter ruleset, bukan LTP sintetis.

- `GET /api/v1/market-data/snapshot?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `GET /api/v1/market-data/snapshot?...&fromTradeSequence=2&toTradeSequence=10`
- `GET /api/v1/market-data/events?...&afterTradeSequence=10&limit=100`
- `GET /api/v1/market-data/replay?seriesCode=PTBAE-IND&compliancePeriod=2027`

VWAP dihitung sebagai total notional dibagi total volume untuk window yang dipilih. Replay menerapkan trade berdasarkan `tradeSequence` dan menghasilkan rolling LTP/OHLCV serta final statistics yang dapat dibandingkan dengan snapshot.

## Tahap 7 Settlement/SRUK

Trade tetap berada di executed-pending sampai rangkaian DvP dan SRUK selesai. Alur normal adalah membuat SettlementInstruction dari trade, memproses DvP, mengirim pesan registry, lalu menerima acknowledgement dengan quantity yang persis sama. Reconciliation yang cocok membentuk empat ledger entry dan memperbarui holding serta posisi acknowledged tepat satu kali.

- `POST /api/v1/settlements/from-trade/:tradeId`
- `GET /api/v1/settlements?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `GET /api/v1/settlements/:settlementId`
- `POST /api/v1/settlements/:settlementId/process`
- `POST /api/v1/settlements/:settlementId/fail`
- `POST /api/v1/settlements/:settlementId/retry`
- `POST /api/v1/settlements/:settlementId/reverse`
- `POST /api/v1/registry/messages/:registryMessageId/send`
- `POST /api/v1/registry/messages/:registryMessageId/acknowledge`
- `POST /api/v1/registry/messages/:registryMessageId/reject`
- `POST /api/v1/registry/messages/:registryMessageId/retry`
- `POST /api/v1/reconciliations/:reconciliationId/resolve`

Semua command mutasi menerima `idempotencyKey`. Acknowledgement menerima `registryReference` unik dan `acknowledgedQuantity`. Quantity yang tidak cocok menghasilkan `EXCEPTION` tanpa perubahan posisi; pesan dapat dikirim ulang atau diselesaikan manual dengan quantity yang sudah dikoreksi.

## Tahap 8 Ruleset/Admin & Audit

Ruleset aktif menentukan tick, lot, price band, sell cap, ambang surveillance, dan settlement finality yang dipakai order serta settlement baru. Versi historis tetap tersimpan pada order, trade, settlement, reconciliation, ledger, dan audit event. Ruleset aktif tidak dapat diedit in place; perubahan harus melalui draft versi baru.

- `GET /api/v1/rulesets`
- `GET /api/v1/rulesets/:rulesetId`
- `POST /api/v1/rulesets`
- `PUT /api/v1/rulesets/:rulesetId`
- `POST /api/v1/rulesets/:rulesetId/approve`
- `POST /api/v1/rulesets/:rulesetId/activate`
- `GET /api/v1/market-sessions/:sessionId`
- `POST /api/v1/market-sessions/:sessionId/open`
- `POST /api/v1/market-sessions/:sessionId/halt`
- `POST /api/v1/market-sessions/:sessionId/resume`
- `POST /api/v1/market-sessions/:sessionId/close`
- `GET /api/v1/audit-events`
- `GET /api/v1/surveillance-alerts`
- `POST /api/v1/scenarios`
- `GET /api/v1/scenarios`
- `POST /api/v1/scenarios/:scenarioId/run`
- `POST /api/v1/scenarios/:scenarioId/replay/:runId`
- `GET /api/v1/scenarios/runs/:runId/export`
- `POST /api/v1/scenarios/runs/compare`

Settlement finality dapat dipilih per ruleset: `SRUK_ACK_RECONCILED` memperbarui posisi setelah acknowledgement yang cocok, sedangkan `DVP_SETTLED` memperbaruinya saat DvP selesai dan tetap merekonsiliasi acknowledgement SRUK tanpa double posting. Semua command admin wajib membawa `idempotencyKey`, `actorId`, dan `permissionContext`.

## Tahap 9 UAT & Production Readiness

`pnpm uat:synthetic` menjalankan happy path 2025 lengkap dan negative controls 2026 terhadap API PostgreSQL yang sedang aktif. Gunakan database UAT disposable karena runner sengaja membuat ruleset, order, trade, settlement, dan perubahan posisi. UI menyediakan pemilih periode 2024–2027; order entry otomatis nonaktif ketika tampilan posisi bukan periode market aktif.

Konfigurasi staging tersedia di `.env.staging.example`. Pada mode production, API gagal start bila API-key auth, database, atau origin CORS belum dikonfigurasi. Detail release gate, batas kesiapan, rollback, serta backup/restore terdapat di [docs/production-readiness.md](docs/production-readiness.md).

## Dokumentasi

Rencana lengkap tersedia di [docs/development-plan.md](docs/development-plan.md).
