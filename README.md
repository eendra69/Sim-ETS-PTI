# Simulator Regular Market PTBAE IND

Prototype untuk menghitung posisi kepatuhan tahunan dan mensimulasikan perdagangan PTBAE-IND melalui Regular Market. Scope release ini hanya mencakup LIMIT, MARKET, dan STOP Order. Auction, Negotiated Market, dan Marketplace tidak termasuk.

## Status

Fondasi repository dan Tahap 1 Annual Position and Balance sedang dibangun. Implementasi awal menyediakan:

- monorepo TypeScript dengan NestJS API dan React web;
- formula posisi tahunan, batas jual, dan kebutuhan beli;
- saldo kuota, buying capacity, dan reservasi atomik in-memory;
- fixture Industri A, B, C, dan D untuk periode 2027;
- PostgreSQL schema dan seed data;
- Docker Compose untuk database lokal; dan
- unit serta integration tests.

Default simulator bukan ketentuan pasar resmi. Parameter market harus dibaca dari MarketRuleset versioned.

## Menjalankan lokal

Prasyarat: Node.js 22+, pnpm, dan Docker Desktop.

```bash
pnpm install
docker compose up -d postgres
pnpm dev
```

API tersedia di `http://localhost:3000/api/v1` dan web di `http://localhost:5173`.

## Perintah

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm db:up
pnpm db:down
```

## Endpoint Tahap 1

- `GET /api/v1/health`
- `GET /api/v1/positions?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `GET /api/v1/positions/:participantId?seriesCode=PTBAE-IND&compliancePeriod=2027`
- `POST /api/v1/balance-reservations/sell`
- `POST /api/v1/balance-reservations/buy`
- `DELETE /api/v1/balance-reservations/:reservationId`

## Dokumentasi

Rencana lengkap tersedia di [docs/development-plan.md](docs/development-plan.md).
