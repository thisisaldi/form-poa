# Business Rules — Approval Level Dinamis

Sumber: tabel "Syarat Level Approval DPL, DPF & Discount Custom" (Exodus, screenshot dari user 2026-09-29): "Level approval ditentukan berdasarkan persentase diskon yang menjadi beban Principal dan dihitung secara terpisah untuk setiap produk."

## §1. Tabel level

| Disc PI (`estimasiDiskonPct`) | Approval hingga | Level yang harus disetujui (berurutan) |
|---|---|---|
| ≤ 5% | ASM | ASM |
| > 5% – 10% | SM | ASM → SM |
| > 10% – 20% | NSM | ASM → SM → NSM |
| > 20% – 30% | ASD | ASM → SM → NSM → ASD |
| > 30% | SD | ASM → SM → NSM → ASD → SD |

Implementasi fungsi: `discountApprovalLevel` (`src/lib/discountApprovalLevel.ts`, sudah ada; batas 5/10/20/30 inklusif di sisi bawah, dicek `scripts/checkDiscountApprovalLevel.ts`).

## §2. Angka yang dipakai & kapan dihitung

- Sumber angka: `PoaStandarisasiProduk.estimasiDiskonPct` (isian Planning) — satu-satunya % diskon PI yang sudah ada saat Fase 2 (`finalDiscountPct` baru terisi di Finalisasi, Fase 4). Jawaban user 2026-09-29.
- Produk dengan `skemaPembayaran = DP` (bukan DISKON) atau `estimasiDiskonPct` kosong: dihitung 0% → level ASM (asumsi, lihat Q4).
- Level DIHITUNG SEKALI dan di-snapshot saat `advanceToApprovalAtasanAction` (Planning → Approval Atasan), bukan live-derive. Planning terkunci setelah itu (`canEditPoaStandarisasi` butuh fase PLANNING), jadi angka tidak berubah selama Fase 2; snapshot dipakai supaya perubahan tabel level di masa depan tidak mengubah pengajuan yang sedang berjalan.

## §3. Lifecycle Fase 2 per produk

Setiap produk punya rantai approval sendiri (baris `PoaStandarisasiProdukApproval`, satu per level yang dibutuhkan), status `MENUNGGU → DISETUJUI | DITOLAK`.

| Aturan | Isi |
|---|---|
| Urutan | Level N bisa bertindak hanya setelah level N-1 produk itu `DISETUJUI` (sama dengan pola sekarang, sekarang per produk) |
| Approver | Satu approver bisa menyetujui beberapa produk sekaligus (aksi "setujui semua produk yang menunggu saya") — lihat `03-ui-and-access.md` |
| Lanjut ke Fase 3 | Semua baris approval SEMUA produk `DISETUJUI` |
| Tanpa aksi lain | Produk yang levelnya lebih rendah tidak menunggu produk lain; cuma perlu approver level yang lebih tinggi untuk produk yang membutuhkannya |
| Ditolak | `DITOLAK` menahan pengajuan di Fase 2 dan level di atasnya untuk produk itu tidak bisa bertindak (Q2). Ajukan ulang belum di v1 |

## §4. Perilaku kegagalan

- Snapshot level gagal dihitung (disc tidak valid, mis. negatif/NaN): dianggap 0% (ASM), tidak boleh memblok pindah fase — konsisten dengan sikap "degrade, jangan blok" di sisi lain.
- Approver level ASD tidak ada di chain (kosong): SD boleh menyetujui baris level ASD langsung (Q1). Level lain kosong: hanya ADMIN yang bisa bertindak (sama dengan perilaku sekarang untuk ASM/SM/NSM kosong).

## §5. Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Blocking? | Asumsi kerja | Siapa yang konfirmasi |
|---|---|---|---|---|
| Q1 | **ASD kosong.** Di data nyata NSM Umi Salamah (995338) atasannya langsung SD (P200134), dan Exodus mengembalikan zona ASD `V-ASD-ETH` "VACANT" untuk NIP itu. | — | ✅ Jawaban user 2026-09-29 ("langsung approve asd dan sd"), diinterpretasikan: kalau tidak ada GM (ASD) di atas NSM, SD menyetujui baris level ASD langsung (tidak ada auto-skip, tidak ada status `DILEWATI`). Interpretasi ini perlu dikonfirmasi user. | User |
| Q2 | **Penolakan.** Kalau satu produk ditolak? | — | ✅ Jawaban user 2026-09-29: pengajuan tertahan; "mungkin bisa ajukan lagi" (ajukan ulang = belum diputuskan, di luar v1). | Bisnis (ajukan ulang) |
| Q3 | Pengajuan yang sudah berjalan di Fase 2 saat fitur ini rilis (baris lama: `statusApprovalAsm/Sm/Nsm` di header) — dimigrasi ke baris per produk atau dibiarkan jalur lama? | Tidak | Jalur lama tetap untuk pengajuan yang sudah lewat Planning saat rilis (kolom header dipertahankan); pengajuan baru pakai jalur baru. | Dev |
| Q4 | Produk skema DP / diskon kosong dihitung level apa? | Tidak | 0% → ASM | Bisnis |
| Q5 | Apakah level per produk boleh dinaikkan manual (mis. ASM minta eskalasi ke SM)? | Tidak | Tidak, otomatis dari tabel saja | Bisnis |
