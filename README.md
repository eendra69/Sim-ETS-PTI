# Simulator Regular Market PTBAE IND

Prototype untuk menghitung posisi kepatuhan tahunan dan mensimulasikan perdagangan PTBAE-IND melalui Regular Market. Scope release ini hanya mencakup LIMIT, MARKET, dan STOP Order. Auction, Negotiated Market, dan Marketplace tidak termasuk.

## Status

Tahap 1 sampai 5 telah lolos gate. Tahap 6 Trade/Market Data menyediakan:

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
- statistik berbasis trade-sequence window; serta
- resumable trade-event feed dan deterministic replay.

Default simulator bukan ketentuan pasar resmi. Parameter market harus dibaca dari MarketRuleset versioned.

## Menjalankan lokal

Prasyarat: Node.js 22+, pnpm, dan Docker Desktop.

```bash
Copy-Item .env.example .env
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

`PERSISTENCE_MODE=postgres` adalah mode lokal normal. Test otomatis memakai fixture in-memory yang terisolasi agar cepat dan deterministik.

API tersedia di `http://localhost:3000/api/v1` dan web di `http://localhost:5173`.

## Perintah

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm db:up
pnpm db:migrate
pnpm db:down
```

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

Ruleset prototype saat ini: reference price Rp75.000, price band Rp60.000–Rp90.000, tick Rp200, dan lot 1 tCO2e. Parameter ini bukan ketentuan pasar resmi dan akan dipindahkan ke ruleset versioned/admin pada tahap 8.

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

## Dokumentasi

Rencana lengkap tersedia di [docs/development-plan.md](docs/development-plan.md).
