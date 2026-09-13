# Tahap 9 — UAT & Production Readiness

Tahap ini adalah release gate untuk simulator Regular Market PTBAE-IND. UAT memakai posisi sintetis tahun 2025 yang berstatus `VERIFIED`; data 2026 tetap `PROVISIONAL` dan tidak dapat membentuk hak jual.

## Release gate

Semua butir berikut wajib hijau sebelum promosi ke staging atau production:

1. `pnpm data:generate:synthetic` dan `pnpm data:validate:synthetic` lulus dengan hash dataset yang terdokumentasi.
2. `pnpm typecheck`, `pnpm test`, dan `pnpm build` lulus.
3. Seluruh migration dan seed dijalankan pada database kosong.
4. API menjawab `/api/v1/health/live` dan `/api/v1/health/ready`; readiness harus menyebut `database: postgres`.
5. `pnpm uat:synthetic` lulus dan artefak JSON disimpan.
6. Backup terbaru tersedia dan restore drill sudah dibuktikan pada database non-production.
7. `AUTH_MODE=api-key`, origin CORS spesifik, TLS pada reverse proxy, dan secret tidak berada di repository.
8. Operator bisnis menyetujui expected result pada bagian UAT di bawah.

## Menjalankan UAT sintetis

UAT harus dijalankan pada database staging yang disposable atau salinan khusus UAT karena proses membuat ruleset/session/order/trade/settlement baru dan memperbarui posisi 2025.

```powershell
$env:UAT_BASE_URL='http://localhost:3100/api/v1'
$env:UAT_API_KEY='<key dengan role ADMIN,AUDITOR,MARKET_OPERATOR,SETTLEMENT_OPERATOR,UAT_OPERATOR>'
$env:UAT_ACTOR_ID='<actorId yang dipetakan ke key tersebut>'
pnpm uat:synthetic
```

Runner memverifikasi:

- 42 peserta dan provenance sintetis 2025;
- hak jual/beli dihitung dari posisi tahunan;
- posisi provisional 2026 ditolak untuk reservasi jual;
- autentikasi, role, participant scope, dan actor audit;
- LIMIT order, price-time matching, harga, serta trade;
- DvP, instruksi SRUK, acknowledgment, dan reconciliation;
- acknowledged sale/purchase berubah tepat sebesar trade dan pending balance kembali bersih.

Laporan default berada di `outputs/uat/uat-synthetic-2025.json`. CI mengunggahnya sebagai artefak walaupun job gagal.

## Staging dan konfigurasi

Salin `.env.staging.example` ke secret manager/deployment environment lalu ganti semua placeholder. API akan gagal start pada `NODE_ENV=production` bila auth tidak aktif, daftar key kosong, database URL tidak tersedia, atau `WEB_ORIGIN` tidak spesifik. API key adalah gate untuk prototype/staging; integrasi IAM/OIDC dan lifecycle credential institusional masih merupakan syarat sebelum pengguna eksternal production.

Endpoint operasi:

- `GET /api/v1/health/live`: proses hidup;
- `GET /api/v1/health/ready`: konektivitas PostgreSQL;
- `GET /api/v1/metrics`: metrik Prometheus dasar;
- semua respons memiliki `x-correlation-id`, security headers, dan log request JSON.

## Publikasi demo Render

`render.yaml` mendefinisikan satu static web, satu Node API, dan satu PostgreSQL. Saat API mulai, `apps/api/scripts/database-bootstrap.mjs` memperoleh advisory lock, menjalankan migration yang belum tercatat, lalu menjalankan seluruh seed idempotent. Secret `API_KEYS_JSON` sengaja berstatus `sync: false` sehingga wajib dimasukkan melalui dashboard dan tidak pernah disimpan di Git.

Blueprint saat ini menunjuk branch `feature/uat-production-readiness`. Setelah branch digabung ke `main`, ubah atau hapus properti `branch` agar deployment mengikuti branch utama. Paket gratis Render hanya sesuai untuk demo: web service dapat sleep dan database gratis kedaluwarsa 30 hari tanpa backup terkelola.

## Backup dan restore drill

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File database/backup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File database/restore.ps1 `
  -BackupFile outputs/backups/<file>.dump -ConfirmRestore
```

Restore bersifat destruktif dan skrip sengaja hanya menerima target bernama `sim_ets` atau `sim_ets_*`. Untuk drill, buat database sementara bernama jelas seperti `sim_ets_restore_drill`, arahkan parameter `-Database` ke sana, lalu ulangi health, row-count dataset, dan UAT. Jangan menganggap backup valid sebelum restore drill berhasil.

## Rollback

1. Hentikan order entry melalui market session `HALT` atau `CLOSE`.
2. Simpan audit, log, UAT report, dan backup sebelum perubahan.
3. Roll back image aplikasi ke artefak terakhir yang disetujui. Migration saat ini forward-only; bila schema perlu dikembalikan, restore backup ke instance baru lalu alihkan koneksi setelah rekonsiliasi.
4. Rekonsiliasi seluruh settlement berstatus non-final dengan SRUK sebelum membuka kembali sesi.

## Batas kesiapan

Tahap ini membuat prototype layak UAT/staging dan menyediakan kontrol operasional dasar. Go-live produksi nyata masih memerlukan keputusan organisasi untuk IAM/OIDC, TLS/WAF, secret rotation, managed PostgreSQL/HA, retention audit, observability terpusat, load/soak test terhadap target SLA, penetration test, disaster-recovery RPO/RTO, serta integrasi SRUK resmi. Auction, Negotiated Market, dan Marketplace tetap di luar scope.
