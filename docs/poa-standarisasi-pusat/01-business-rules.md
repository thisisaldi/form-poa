# POA Standarisasi Pusat — Business Rules

Sumber: percakapan pengguna 2026-10-06 + `internal/Grouping Hospital Key Account (1).xlsx`, `internal/TARGET Hospital Key Account Q3.xlsx`.

## §1. Definisi

| Istilah | Definisi |
|---|---|
| HKA | Divisi Hospital Key Account. Anggota (NIP): Ahsanul Chalid `972977` (role ASD, label "DIR"), Widodo `P240249` (NSM), Masril `P240245` (NSM, sekarang HKA) |
| Grup HKA | 11 grup di file Grouping: Hermina 56, IHC 53, Siloam 43, Primaya 30, Mitra Keluarga 24, Bunda 11, Murni Teguh 10, Mayapada 9, Eka 9, Columbia 8, Mitra 2 = 255 outlet. 1 outlet masuk maksimal 1 grup (diverifikasi, tidak ada duplikat) |
| Standarisasi pusat | Pengajuan Produk × Grup HKA oleh orang HKA |
| "Sudah standarisasi" (cabang) | Definisi existing 2026-10-01: sales `qty>0` di 3 bulan kalender penuh terakhir **DAN** DPL aktif bulan berjalan (`computeStatusPengajuanMap`, `getStandarisasiGroupOutletsAction` di `src/app/actions/poaStandarisasi.ts`) |

## §2. Gateway standarisasi cabang

Pengajuan cabang (`PoaStandarisasi`) untuk outlet O, produk P, **hanya boleh** jika SALAH SATU:

| # | Kondisi | Catatan |
|---|---|---|
| a | O tidak punya `hkaGroup` (di luar 255 outlet) | Gateway tidak berlaku (dikonfirmasi) |
| b | Ada pengajuan pusat untuk (grup O, P) yang sudah final (`submittedAt` terisi) | |
| c | Ada outlet MANAPUN di grup O (termasuk O sendiri) yang "sudah standarisasi" untuk P | Dikonfirmasi: "produk A pernah masuk di salah satu cabang → dihitung pernah standarisasi pusat" |

Selain itu → ditolak dengan pesan: "Produk {P} belum pernah distandarisasi di grup {G}. Ajukan standarisasi pusat lewat tim HKA dulu."

- Dicek di server saat Planning disimpan (`applyPlanningProduk`) per produk, bukan hanya di UI; UI hanya menampilkan hint di pemilih produk.
- Pengajuan cabang yang sudah tersimpan **tidak dicek ulang** (tidak ada penolakan retroaktif); hanya produk baru/berubah saat Planning disimpan.
- Data c dibaca dari `OutletSalesMonthly` dan `getDiskonByOutlets` (batched, DB-only; `docs/PERFORMANCE.md` §2.4 melarang N HTTP call). Cakupan maksimal 56 outlet per grup.

## §3. Lifecycle pengajuan pusat (asumsi v1 — lihat Q1)

`PLANNING → APPROVAL_ATASAN → APPROVAL_USER_DOKTER → FINALISASI` (final = `submittedAt` terisi) — 4 fase sama dengan cabang (dikonfirmasi 2026-10-06: approval dokter juga berlaku, dokter boleh dipilih dari outlet mana pun di grup). Tanpa KPDM dan tanpa Step 5 (SP Non Sales/DPL-DPF) di v1 (asumsi Q1).

| Phase | Isi |
|---|---|
| PLANNING | Pilih grup, tipe (Periodic/Sisipan/Permanen + periode), N produk; per produk: skema Diskon/DP, Estimasi Diskon PI %, Diskon Distributor %, Value DP (Rp), catatan |
| APPROVAL_ATASAN | Per produk, rantai level dari `discountApprovalLevel(estimasiDiskonPct)` (tabel di `docs/poa-standarisasi-approval-level/01-business-rules.md` §1) |
| APPROVAL_USER_DOKTER | Per produk, pembuat memilih dokter dari outlet MANA PUN di grup (`Outlet.hkaGroup` sama), lalu mencentang "Sudah TTD" (checkbox manual, sama dengan cabang). Minimal 1 dokter wajib per produk, semua dokter wajib sudah TTD sebelum lanjut. Ganti dokter = hapus + tambah, tanpa alasan di v1 |
| FINALISASI | Pembuat submit akhir (`submittedAt`). Upload surat approval belum ada di v1 |

Pemilih dokter dua langkah (pilih outlet di grup → pilih dokter dari `getCustomersByOutlet()`, Nexus-primary untuk spesialisasi, JANGAN `getCustomersByOutletSpesialisasi`), bukan memuat dokter 56 outlet sekaligus (`docs/PERFORMANCE.md`).

## §4. Approval

Level dihitung sekali (snapshot) saat Planning → Approval, per produk, dengan tabel yang sama dengan cabang (≤5% ASM, >5–10% SM, >10–20% NSM, >20–30% ASD, >30% SD; produk DP/kosong = 0%).

| Pembuat | Level yang otomatis `DISETUJUI` | Yang perlu persetujuan |
|---|---|---|
| Widodo / Masril (NSM) | ASM, SM, NSM | ASD (>20%), SD (>30%) |
| Ahsanul (ASD) | ASM, SM, NSM, ASD | SD (>30%) |

- Baris approval tetap dibuat per level (audit trail), status awal `DISETUJUI` dengan `approverNip` = pembuat dan `autoApproved = true`.
- Approver tetap (tidak lewat rantai `nipAtasan`, karena pusat tidak punya MR): ASD = `972977` (Ahsanul), SD = `P200134` (Brian Lembong). Satu konstanta (`HKA_APPROVER_NIP`), bukan hardcode tersebar.
- Semua level semua produk `DISETUJUI` (termasuk otomatis) → lanjut ke FINALISASI. Kalau seluruh level otomatis lolos, transisi terjadi langsung saat advance.
- `DITOLAK` menahan pengajuan; ajukan ulang di luar v1 (sama dengan cabang).
- Pembuat tidak boleh menyetujui level di atasnya sendiri (Widodo tidak bisa menyetujui level ASD). Level ASM/SM/NSM yang masih menunggu (pembuat non-HKA, hanya ADMIN) hanya bisa dikerjakan ADMIN.
- Planning tidak punya fase terpisah: create langsung menyimpan produk + snapshot approval dan masuk APPROVAL_ATASAN (sama dengan `createPoaStandarisasiAction`).

## §5. Perilaku kegagalan

- Gagal baca sales/DPL grup saat cek gateway → **fail-open** (izinkan) + log, konsisten dengan sikap "degrade, jangan blok" di fitur ini (asumsi Q3).
- Grup tanpa satu pun produk yang sudah standarisasi → semua produk diblok sampai ada pengajuan pusat. Ini perilaku yang diharapkan, bukan error.
- Import grup: kodePI di xlsx yang tidak ada di tabel `Outlet` dilaporkan dan dilewati, tidak dibuat.

## §6. Non-goals v1

Target sales Q3 (sheet FIX TARGET/Target By NHKAM), PIC HKA per outlet (Masril vs Widodo), dashboard monitoring pusat, notifikasi, ajukan ulang setelah ditolak, DPL/DPF dari pusat, KPDM untuk pusat, estimasi pasien/resep per dokter (cabang punya; pusat v1 hanya checklist TTD — tambah kalau dibutuhkan).

## §7. Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Blocking? | Asumsi kerja | Konfirmasi dari |
|---|---|---|---|---|
| Q1 | Fase pusat: 4 fase sudah dikonfirmasi (termasuk dokter). Sisa: apakah KPDM/estimasi per dokter/Step 5 juga berlaku, dan apa output pusat selain "gateway terbuka" (mis. batas diskon yang jadi acuan cabang)? | Tidak lagi (gateway + approval + dokter sudah cukup untuk mulai) | Tanpa KPDM/estimasi dokter/Step 5; pusat hanya membuka gateway, belum membatasi angka cabang | Pengguna / HKA |
| Q2 | BUMN ada di file Target (12 grup) tapi tidak di file Grouping (11 grup). Sumber grup yang resmi? | Tidak | Import dari file Grouping saja; BUMN menyusul (sheet PIC punya `Outlet Grup`=BUMN per outlet, bisa jadi sumber) | Pengguna |
| Q3 | Fail-open vs fail-closed saat data gateway gagal dibaca | Tidak | Fail-open + log | Pengguna |
| Q4 | Nama grup HKA ("Hermina") vs `Outlet.groupRS` existing ("HERMINA GRUP") — sama? | Tidak | Kolom terpisah `hkaGroup`, tidak memakai `groupRS` | Dev (cek data prod) |
| Q5 | Akun Ahsanul sudah ada di `User`? Role di DB? | Tidak | Role `GM` (= level ASD di DB, lihat komentar enum `Role`), `jabatan = "DIR"` untuk label | Dev (cek DB) |
| Q6 | Gateway untuk produk yang diganti di Planning cabang setelah tersimpan | Tidak | Dicek ulang tiap Planning disimpan | — |
