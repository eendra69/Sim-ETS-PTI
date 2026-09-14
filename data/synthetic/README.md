# Dataset Kepatuhan Sintetis 2024–2026

Dataset ini dibuat untuk UAT Simulator Regular Market PTBAE-IND. Seluruh peserta, alokasi, emisi, banking, offset, dan saldo merupakan data sintetis dan tidak mewakili perusahaan atau penetapan pemerintah yang sebenarnya.

## Cakupan

- 42 peserta: tujuh arketipe usaha, tiga skala, dan dua profil operasi.
- 126 posisi tahunan untuk 2024, 2025, dan 2026.
- 2024–2025 berstatus `VERIFIED`; 2026 berstatus `PROVISIONAL`.
- Seluruh quantity dibulatkan ke lot 1.000 tCO2e.
- Pembelian dan penjualan acknowledged dimulai dari nol agar dataset dapat dipakai sebagai opening state UAT.
- Carry-over dibentuk dari sebagian surplus periode sebelumnya.
- Random seed tetap `20240914`; menjalankan generator kembali menghasilkan dataset yang identik.

## Berkas

- `participants_2024_2026.csv`: master peserta sintetis.
- `compliance_positions_2024_2026.csv`: input kuota, emisi, banking, offset, holding, dan buying capacity.
- `expected_positions_2024_2026.csv`: expected result perhitungan posisi.
- `negative_cases_2024_2026.csv`: kasus yang harus ditolak importer.

Setelah seed kepatuhan dimuat, `database/seeds/004_vintage_installation_2024_2027.sql` membentuk installation, trader scope, katalog vintage, eligibility, dan holding sintetis. Holding hanya berasal dari surplus bruto pada tahun yang sama. Kolom agregat `eligible_banked_units` sengaja tidak dikonversi menjadi vintage tertentu karena dataset tidak menyimpan tahun asalnya.

Semua aturan carry-over/banking pada seed katalog diberi `SIMULATION_ASSUMPTION`. Data 2026 tetap `PROVISIONAL`; karena itu nilai holding dapat terlihat untuk analisis tetapi belum menjadi kuantitas yang dapat dijual.
- `dataset-summary.json`: kontrol jumlah record, total tahunan, dan SHA-256 dataset.
- `generate-dataset.mjs`: generator deterministik.

## Formula expected result

```text
gross_position = allocated_quota - verified_emission
net_position = allocated_quota + acknowledged_purchases - acknowledged_sales
             + eligible_banked_units + eligible_offset_applied - verified_emission
max_sell_quantity = min(eligible_holding, max(0, net_position))
buy_need_remaining = max(0, -net_position)
```

`quota_adjustment` sudah termasuk dalam `allocated_quota`; kolom itu dipertahankan agar asal perubahan alokasi dapat ditelusuri.

## Memuat ke PostgreSQL

```powershell
pnpm db:migrate
pnpm db:seed:synthetic
```

Seed bersifat idempotent. Import ulang memperbarui input kepatuhan sintetis tetapi tidak menimpa pembelian/penjualan acknowledged atau balance account yang sudah memiliki aktivitas transaksi.
