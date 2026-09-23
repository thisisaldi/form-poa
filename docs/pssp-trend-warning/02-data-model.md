# PSSP Trend Warning — Data Model

## Data yang sudah ada (reuse, tanpa perubahan skema)

- `PsspKontrak` (`prisma/schema.prisma:686+`) — sumber "Aktif", lewat `getActivePsspByOutlets` (`src/app/actions/customer.ts:353-393`).
- `PoaLineItem` + `computeMonthlyBreakdown` (`src/lib/poaUtils.ts`) — sumber "Rencana".
- `getSubordinateMRNips` (`src/lib/authz.ts:126-148`) — scoping MR per role, dipakai buat batasi query snapshot job per MR yang visible ke actor.

## Model baru

```prisma
model PsspTrendSnapshot {
  id            String   @id @default(cuid())
  nip           String   // MR pemilik snapshot
  periode       String   // YYYYMM — bulan yang di-snapshot, format sama seperti model lain (lihat schema.prisma existing convention)
  totalRencana  Decimal  @db.Decimal(18, 2)
  totalAktif    Int      // jumlah kontrak PSSP aktif (count, bukan Rp — samakan definisi dgn chart Summary §1)
  capturedAt    DateTime @default(now())

  user User @relation(fields: [nip], references: [nip])

  @@unique([nip, periode])
  @@index([periode])
}
```

### Catatan desain

- **Snapshot, bukan live-derive** — beda dari kebanyakan model di app ini yang dihitung on-the-fly. Sengaja dibekukan per bulan karena §2 di `01-business-rules.md`: re-query `PsspKontrak` untuk bulan yang sudah lewat tidak akurat (kontrak yang sudah berakhir hari ini hilang dari hasil query, padahal waktu itu aktif). Pola serupa dengan `KpiMonthlyEntry` snapshot di `docs/kpi-monitoring/` — TAPI beda dari sana, field snapshot ini WAJIB benar-benar ditulis oleh job/action nyata (lihat catatan koreksi status di `docs/kpi-monitoring/README.md` baris 21 — field snapshot yang dijanjiin di spec tapi tidak pernah ditulis kode, jangan diulang kesalahan yang sama di sini).
- `@@unique([nip, periode])` — satu snapshot per MR per bulan, append-only secara konsep (idealnya tidak di-overwrite kecuali re-run sengaja buat bulan yang sama).
- `totalAktif` sebagai `Int` (count kontrak), bukan Rp — ikutin definisi "Aktif" yang dipakai chart Summary existing (count-based lewat `tercacahAktifForQuarter`), BUKAN value. Kalau ternyata yang dimaksud Brian Lembong adalah value Rp, field ini perlu direvisi sebelum implementasi — lihat Open Questions di `01-business-rules.md` (belum dicatat eksplisit di sana, tambahkan kalau muncul saat convergence check).
- Tidak ada `deltaPct`/`turun` tersimpan di tabel ini — perbandingan "turun atau tidak" dihitung saat dibaca (`totalIni < snapshot bulan lalu`), bukan disimpan sebagai kolom terpisah, supaya tidak ada 2 sumber kebenaran kalau logic threshold berubah (lihat Open Question #1).

## Performance

Job penulisan snapshot berpotensi company-wide kalau dijadwalkan (bukan manual per-MR) — **WAJIB baca `docs/PERFORMANCE.md` sebelum implementasi** kalau job-nya jalan lintas semua MR sekaligus. `getActivePsspByOutlets` sendiri sudah outlet-scoped + `prdAkhir`-bounded (bukan unbounded scan), tapi untuk ADMIN/GM yang visible ke seluruh MR, jumlah outlet yang di-query bisa sebesar seluruh perusahaan — sama beban dengan Summary page load company-wide yang sudah jalan sekarang, jadi tidak lebih berat dari existing, tapi tetap perlu dicek terhadap constraint `docs/PERFORMANCE.md` §2 sebelum dijadwalkan sebagai cron (bukan manual trigger).
