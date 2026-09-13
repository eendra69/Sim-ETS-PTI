# Simulator Regular Market PTBAE IND

Prototype untuk menghitung posisi kepatuhan tahunan dan mensimulasikan perdagangan PTBAE-IND melalui Regular Market. Scope release ini hanya mencakup LIMIT, MARKET, dan STOP Order. Auction, Negotiated Market, dan Marketplace tidak termasuk.

## Status

Tahap 1 sampai 3 telah lolos gate. Tahap 4 MARKET Order menyediakan:

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
- IOC multi-level sweep tanpa menempatkan MARKET ke visible book; dan
- `CANCELLED_REMAINDER` serta pelepasan reservation yang tidak terpakai.

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

## Dokumentasi

Rencana lengkap tersedia di [docs/development-plan.md](docs/development-plan.md).
