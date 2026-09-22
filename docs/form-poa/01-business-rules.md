# Form POA — Business Rules

*(Retroaktif — didokumentasikan dari kode yang ada: `src/lib/poaWorkflow.ts`, `src/lib/authz.ts`, `src/app/actions/poa.ts`, `prisma/schema.prisma`, `src/components/poa/LineItemEditor.tsx`, `src/components/poa/DraftChecklist.tsx`, `src/lib/poaUtils.ts`. Semua klaim memiliki referensi file:line.)*

## 1. POA — apa itu & lifecycle

`PoaForm` (`prisma/schema.prisma:143-165`) adalah rencana penjualan milik 1 MR (atau ASM/SM/NSM sebagai pengganti apabila tim MR-nya vacant) untuk 1 kuartal (`period`, format `"YYYY-QN"`, divalidasi di `LineItemEditor.tsx:517-524`; dibuat melalui `createPoaAction`, `src/app/actions/poa.ts:20-40`). Field kunci: `status` (`PoaStatus`), `version` (naik setiap kali kembali ke REVISI), `target` (override manual dari atasan, dalam Rupiah), `ownerId`, `currentHolderId` (siapa yang harus bertindak selanjutnya — null apabila masih DRAFT atau sudah fully-approved).

### Status (`PoaStatus` enum, `schema.prisma:27-36`)

⚠️ **Bagian "State machine"/"Alur khusus" di bawah ini menjelaskan model WHOLE-DRAFT LAMA** (`approvePoa`/`fastTrackApprove`/`rejectPoa`/dst di level `PoaForm`) — fungsi-fungsi itu **sudah dihapus total** sejak refactor per-dokter 2026-08-13/08-18 (lihat `docs/poa-per-doctor-approval/`, sumber kebenaran sekarang untuk approve/reject/cancel/request-edit, semuanya di level `PoaDoctorApproval`, bukan `PoaForm`). Ditambah lagi, rantai approval-nya sendiri sudah diperluas dari ASM→SM→NSM fixed menjadi kondisional sampai ASD/SD berdasar ceiling dari Exodus, dan ceiling itu sejak **2026-09-22** juga bisa berhenti di ASM/SM saja (lihat `docs/exodus-poa-usage/01-business-rules.md` §9/§11). **"Fast-track approve" NSM di bawah ini SUDAH DIHAPUS 2026-09-22** (Aldi: melompati ceiling ASD/SD tanpa dicek sama sekali — bug, bukan fitur yang dipertahankan), tidak ada penggantinya. Narasi di bawah dipertahankan apa adanya sebagai catatan historis (arsitektur lama), BUKAN referensi kode aktual — baca `docs/poa-per-doctor-approval/` + `docs/exodus-poa-usage/` untuk perilaku sekarang.

| Status | Arti |
|---|---|
| DRAFT | Owner masih menyusun, belum ada pihak lain yang terlibat |
| SUBMITTED_TO_ASM | Menunggu review ASM |
| APPROVED_BY_ASM | Fully approved kalau ceiling dokter ini = ASM (2026-09-22) — sebelumnya legacy/nyaris tidak pernah terjadi, sekarang status terminal genuine untuk sebagian dokter |
| SUBMITTED_TO_SM | Menunggu review SM |
| APPROVED_BY_SM | Sama seperti APPROVED_BY_ASM — terminal genuine kalau ceiling = SM |
| SUBMITTED_TO_NSM | Menunggu review NSM |
| APPROVED_BY_NSM | Fully approved (ceiling NSM, default), `currentHolderId` null |
| SUBMITTED_TO_ASD | Menunggu review ASD (role DB `GM`) — cuma dicapai kalau ceiling dokter ini ASD/SD |
| APPROVED_BY_ASD | Fully approved kalau ceiling = ASD |
| SUBMITTED_TO_SD | Menunggu review SD (Brian Lembong, `P200134`, satu-satunya) |
| APPROVED_BY_SD | Fully approved, ceiling tertinggi |
| REVISI | Kembali ke owner, harus direvisi & disubmit ulang |

### State machine (historis — lihat catatan ⚠️ di atas)

- **Submit pertama** (`firstSubmitTransition`, `:47-55`) — target-nya 1 level DI ATAS role owner sendiri. Normal: MR→ASM. Apabila ASM/SM yang menjadi owner (kasus tim vacant), langsung melompat ke atasan mereka sendiri.
- **Approve** (`approvePoa`, `:213-232`) — langsung SUBMITTED_TO_ASM→SUBMITTED_TO_SM→SUBMITTED_TO_NSM→APPROVED_BY_NSM, TIDAK ada langkah "submit ke atas" terpisah. Hanya current holder yang boleh memanggilnya (`canApprove`, `authz.ts:353-361`).
- **`resolveNextHolder`** (`:84-95`) — berjalan melalui `nipAtasan`, mencari user aktif pertama di level target atau di atasnya — otomatis menangani level yang vacant.
- Tiap transisi menulis `PoaAuditLog` dan mengirim email (`sendPoaStatusEmail`, `:142-167`). Kegagalan pengiriman email bersifat fire-and-forget — error hanya di-log (`console.error`, `poaWorkflow.ts:165-167`), TIDAK membatalkan transisi status yang sudah ditulis dalam transaksi database.

### Alur khusus (historis — lihat catatan ⚠️ di atas)

- ~~**Fast-track approve**~~ — **DIHAPUS 2026-09-22**, lihat catatan ⚠️ di atas.
- **Reject** (`rejectPoa`, `:268-288`) — current holder manapun reject → REVISI, wajib mengisi alasan, `AuditAction.REJECT`.
- **Cancel Approved by NSM** (`cancelApprovedByNsm`, `:300-320`) — NSM membatalkan approval-nya sendiri → REVISI. Gate: `canCancelApproved` (`authz.ts:393-397`), hanya valid apabila status persis APPROVED_BY_NSM.
- **"Ajukan Edit" (permintaan edit)** — `requestEdit` (`:330-358`): owner meminta izin edit kepada approver terakhir, hanya menulis log `REQUEST_EDIT`, tidak mengubah status. `grantEditRequest` (`:368-386`): approver terakhir memberi izin → kembali ke REVISI (efeknya sama seperti membatalkan approval sendiri). `declineEditRequest` (`:393-414`): log `DECLINE_EDIT`, tidak mengubah status. Gate: `canRequestEdit`/`canRespondEditRequest` (`authz.ts:410-426`).
- **Lock Edit Logic** (`getEditLockLevel`, `authz.ts:245-261`, keputusan bisnis 2026-07-27) — begitu ASM/SM/NSM approve ATAU edit POA yang bukan miliknya sendiri, semua level di BAWAH level tersebut terkunci dari edit sampai siklusnya kembali ke DRAFT/REVISI. Dideteksi dengan memindai `PoaAuditLog` (bukan flag tersimpan) mundur sampai entry DRAFT/REVISI terakhir.
- **`flagRevisionOnEdit`** (`:452-488`) — dipanggil setiap add/edit/delete line item. Apabila belum ada pihak yang approve pada siklus ini, edit tidak berpengaruh terhadap status (owner bebas memperbaiki sebelum direview). Apabila MR owner mengedit SETELAH ada pihak yang approve, status kembali ke REVISI (version++, holder dikosongkan) — meskipun secara normal Lock Edit Logic sudah mencegah situasi ini terjadi tanpa reject/cancel/grant terlebih dahulu.
- **Delete POA** (`deletePoaAction`, `src/app/actions/poa.ts:230-249`) — hanya boleh dilakukan pada POA berstatus DRAFT, oleh owner (via `canEdit`). Berbeda dari transisi status lain di atas, aksi ini MENGHAPUS `PoaForm` dan seluruh `PoaAuditLog`-nya secara permanen dalam satu transaksi (`poa.ts:242-245`) — bukan transisi state machine, melainkan penghapusan total. Dibatasi ke status DRAFT secara eksplisit karena "menghapus POA yang sudah disubmit akan menghancurkan riwayat approval/audit" (komentar `poa.ts:228`). Lihat juga catatan invariant `PoaAuditLog` di `02-data-model.md` §1.
- **Edit Quarter** (`updatePoaPeriodAction`, `src/app/actions/poa.ts:251-289`, stakeholder item #10, 2026-08-03) — owner dapat mengubah kuartal (`period`) POA setelah dibuat, dibatasi ke status DRAFT/REVISI dengan alasan yang sama seperti delete: begitu ada riwayat submission pada siklus berjalan, `period` dianggap terkunci (`:274-276`). Ditolak apabila owner yang sama sudah punya draft lain di periode tujuan (`:279-282`, unique constraint level-aplikasi, bukan dari DB — lihat catatan invariant `PoaForm` di `02-data-model.md` §1). Tidak menyentuh `PoaLineItem.periodeAwal` milik baris-baris yang sudah ada.

## 2. Line Item

`PoaLineItem` (`prisma/schema.prisma:265-355`) — 1 baris per (dokter × outlet × produk). Terdiri dari 3 kelompok field:

- **Customer group** (auto-fill dari lookup `Customer`, `:270-284`): `kodeRequest`, `kodeCust`, `namaCust`, `role`, `spesialisasi`, `isManualCustomer` (true apabila dokternya didaftarkan secara manual, bukan dari sinkronisasi CDB), `historisPSSP`, `kodePI`, `namaOutlet`.
- **Product group** (auto-fill dari lookup `kodeProduk`, `:285-290`): `kodeProduk`, `namaProduk`, `kategoriProdukFokus`, `itemKode`, `satuanTerkecil`.
- **MR manual input** (`:292-333`): field level-dokter yang diduplikasi di semua baris produk milik dokter tersebut — `labelCustomer`, `jenisPsSp` (PS/SP), `bentukPssp` (CASH/BARANG/JASA); field per-produk — `produkKompetitor`, `kriteriaProduk`, `statusStandarisasi`, `jenisPssp`, `pihakPssp` (USER/KPDM, hanya relabel tampilan), `hariKerjaBulan`/`jumlahPasienHari`/`jumlahResepHari`/`qtyProdukResep` (C20-C23, nullable), `lamaPeriode` (1/3/6/12), `periodeAwal` (YYYYMM), `rencanaTotalBiaya`, `rencanaVisitMinggu`, ditambah field pecahan budget: `rasioEstimasiGrowth`, `persenPsspDokter`, `persenPsspKpdm`, `persenDiskon`, `persenDp`, `persenListingFee`, `persenEntertain`.

1 "dokter" = 1 pasangan `(kodePI, namaCust)` (`doctorKey`, `DraftChecklist.tsx:53-55`) — 1 dokter dapat memiliki banyak `PoaLineItem` (1 per produk), berbagi field level-dokter yang sama melalui state `DokterFields` di editor (`LineItemEditor.tsx:120-131`).

### 2a. `statusStandarisasi` & "Tarik Data POA Standarisasi" (sebelumnya tidak terdokumentasi)

`statusStandarisasi` (`StatusStandarisasi` enum: `SUDAH_STANDARISASI` / `PROSES_PENGAJUAN` / `BELUM_STANDARISASI` / `TIDAK_TAHU`) di-auto-fill saat produk dipilih (dropdown ATAU klik sidebar), lewat `buildProdukAutofillPatch()`/inline `onChange` (`LineItemEditor.tsx`) — urutan cek pertama yang match menang:

1. **SUDAH**: pernah PSSP di outlet ini (`psspEverProductNames`, cocok nama produk) ATAU label `OutletProductKriteria.kriteriaBaru` diawali `"Produk Sudah Terstandarisasi"`.
2. **PROSES** (baru 2026-09-22): produk×outlet ini punya pengajuan POA Standarisasi yang sudah dibuat tapi BELUM disubmit (`getStandarisasiProsesKodeByOutletAction` — `PoaStandarisasiProduk` where `pengajuan.submittedAt is null`).
3. **BELUM**: ada label kriteria tapi bukan "Sudah Terstandarisasi".
4. Selain itu kosong (MR isi manual, termasuk `TIDAK_TAHU`).

⚠️ Pengajuan POA Standarisasi yang sudah `submittedAt` (fully submitted, bukan cuma Finalisasi) dan DPL aktif (lihat `docs/poa-standarisasi/01-business-rules.md`'s 4-sinyal Baru/Perpanjangan) **BELUM** ikut jadi sinyal SUDAH di sini — beda dari sidebar "Sudah Standarisasi" POA Standarisasi sendiri yang sudah 3-sumber. Baru diselaraskan kalau ada permintaan lanjut.

**"Tarik Data POA Standarisasi"** — dua toggle terpisah, keduanya cuma menulis field `ProdukEntry`/`PoaLineItem` biasa (persisted seperti input manual), bukan referensi live:
- **Per produk** (2026-09-08, `standarisasiPull`): cuma muncul kalau produk yang SEDANG dipilih di baris itu punya match Finalisasi (`getStandarisasiDataForDokterProdukAction` — outlet+dokter+produk sama, `currentPhase === "FINALISASI"`). Isi Jumlah Pasien/Hari Praktek/Resep ke baris itu saja.
- **Per dokter** (baru 2026-09-22, `TarikStandarisasiBar`): muncul di atas daftar "Produk yang Dipromosikan", kalau outlet+dokter ini punya SATU ATAU LEBIH baris Finalisasi (`getStandarisasiProdukForDokterAction`). Sekali di-toggle ON, SEMUA produk dari Standarisasi ditambahkan sekaligus ke `produkList` — baris dengan `kodeProduk` sama diisi angkanya, sisanya masuk ke baris kosong pertama atau ditambah baru (`mergeStandarisasiRows`). Status produk yang ditarik otomatis `SUDAH_STANDARISASI`.

| Konsep | Formula | Sumber |
|---|---|---|
| **Estimasi** (`rencanaTotalBiaya`) | `jumlahResepHari × qtyProdukResep × hariKerjaBulan × (HNA ÷ konversiPembagi) × lamaPeriode`, dibulatkan | `LineItemEditor.tsx:273-282,191-195` |
| **Nilai PSSP** | `rencanaTotalBiaya × persenPsspDokter × pengaliNilaiR` | `DraftChecklist.tsx:140`, `LineItemEditor.tsx:933` |
| **Pengali Nilai R** | Multiplier manual per-dokter atas dasar % Nilai R produk; teks bebas, default `1` apabila kosong (`resolvePengaliNilaiR`, `LineItemEditor.tsx:201-207`). Nilai tampilan level-dokter = rata-rata tertimbang lintas produk berdasarkan `rencanaTotalBiaya` (`DraftChecklist.tsx:704-717`). |
| **Pihak PSSP** (USER/KPDM) | Hanya switch label tampilan — memilih KPDM mengubah "% PSSP User" menjadi "% PSSP KPDM" di form/export; nilai `persenPsspDokter` & formulanya TIDAK berubah | `schema.prisma:65-73`, `LineItemEditor.tsx:1334` |
| **Total % Budget** | `persenPsspDokter × pengaliNilaiR + persenDiskon + persenDp + persenListingFee + persenEntertain` | `LineItemEditor.tsx:1308-1312` |
| **Threshold Budget** | `>42.5%` = "Melebihi batas"/OVER BUDGET · `38%–42.5%` = "Mendekati batas" · `<38%` = "Aman"/SAFE | `LineItemEditor.tsx:1314,1365`; `export/[id]/export/route.ts:272,623` |
| **Budget agregat** | `budgetTotal = psspTotal + discountTotal + entertainTotal`, `discountTotal` = jumlah `persenDiskon+persenDp+persenListingFee` | `DraftChecklist.tsx:134-155` |
| **Tercacah (apportionment bulanan)** | Dua varian: (a) `computeMonthlyBreakdown` (`src/lib/poaUtils.ts:66-94`) — menyebar Estimasi/Nilai PSSP rata ke tiap bulan rencana, dijumlahkan per bulan kalender — dipakai bersama export & panel Ringkasan & chart Summary. (b) `computeBiayaTercacah` (`DraftChecklist.tsx:57-86`) — apportion total 1 line item ke SEBERAPA BANYAK bulan rencananya yang jatuh di kuartal POA-nya sendiri (misal rencana 6 bulan yang overlap 3 bulan kuartal → dihitung 3/6). Masalah yang diselesaikan: `lamaPeriode` (1/3/6/12) jarang pas 1 kuartal, sehingga total mentah akan overstate apa yang sebenarnya direncanakan "kuartal ini". |
| **Rasio Estimasi / Target** | `(tercacahEstimasiWithAktif ÷ targetArea) × 100` | `DraftChecklist.tsx:376`, `poa/[id]/page.tsx:239` |
| **Resolusi Target** | `poa.target` (manual, di-set atasan) diprioritaskan apabila terisi; apabila kosong, diturunkan dari `SUM(TargetHospitalValue.target)` selama bulan-bulan kuartal itu, lintas semua MR di bawah owner (`getSubordinateMRNips`) | `poa/[id]/page.tsx:212-238` |
| **Growth Estimasi** | `(newEstPerMonth ÷ latestPsspEstPerMonth − 1) × 100%` — baseline dari kontrak PSSP terakhir (aktif/expired) untuk produk yang sama, `estBaris` disebar ke periode kontraknya sendiri (bukan dibagi 3 flat) | `LineItemEditor.tsx:312-341,940-943` |
| **Growth Pelunasan** | `(newEstPerMonth ÷ (latestContractTotalLunas ÷ elapsedMonths) − 1) × 100%` — baseline dari kontrak PSSP terakhir yang benar-benar memiliki pelunasan, dibagi berapa bulan itu SUDAH BENAR-BENAR berjalan (bukan flat /3) | `LineItemEditor.tsx:361-379` |

Copy warning/apresiasi: Growth ≤0% → "⚠ Intensifikasi kurang"; >0% → "✓ ... pastikan nilainya sudah tepat" (`LineItemEditor.tsx:1199-1241`).

## 4. Sistem Quarter/Periode

- `PoaForm.period` = string kuartal `"YYYY-QN"` (mis. `"2026-Q3"`), di-set sekali saat POA dibuat (`src/app/actions/poa.ts:20-38`). Dapat diubah setelah dibuat via "Edit Quarter", tetapi hanya selama status masih DRAFT/REVISI (lihat §1 "Alur khusus").
- Tiap `PoaLineItem` memiliki `periodeAwal` (YYYYMM) + `lamaPeriode` (1/3/6/12) sendiri; `periodeAkhir` tidak pernah disimpan, selalu dihitung dari `periodeAwal + (lamaPeriode−1)` bulan (`src/lib/poaUtils.ts:12-21`).
- **Quarter picker per baris** (request 2026-07-31, `LineItemEditor.tsx:567-579`) — tiap baris dokter dapat memilih kuartal target-nya SENDIRI, independen dari `period` POA induknya — tahun tetap mengikuti tahun POA, tetapi kuartalnya dapat berbeda per baris.

## 5. Klasifikasi Dokter (`labelCustomer`)

`computeLabelCustomer` (`LineItemEditor.tsx:381-405`):
- Tidak ada histori PSSP sama sekali → **"Dokter Baru"**.
- Memiliki ≥1 kontrak yang masih aktif (per kontrak, bukan per produk) → **"Retensi"** (atau "Retensi, Pelunasan Bagus" apabila pelunasan kontrak aktifnya ≥80%).
- Memiliki histori tetapi tidak ada yang aktif saat ini → **"Pernah PSSP"** (atau "Pernah PSSP, Pelunasan Bagus" apabila pelunasan lifetime ≥80%).

⚠️ **Bug stale-snapshot (fixed, commit `20dbd41`)**: `PoaLineItem.labelCustomer` ditulis sekali saat line item dibuat, tidak pernah dihitung ulang. Apabila kontrak PSSP customer baru tersinkronisasi masuk SETELAH line item-nya dibuat, label yang tersimpan tetap "Dokter Baru"/kosong selamanya. Fix: `DraftChecklist.tsx`'s `DoctorRow` dan export Excel per-POA sekarang meng-override nilai stale tersebut menggunakan live check (`everPsspKodeCust`) kapan pun `hasPsspNow` bernilai true tetapi label tersimpan kosong/"Dokter Baru" — label tersimpan yang sudah kaya dan konsisten (mis. "Retensi") dibiarkan apa adanya.

Catatan: "Retensi" memiliki 2 arti berbeda di UI — sense badge Label Customer (≥1 kontrak aktif, tanggal akhir kapan pun) versus sense badge "kartu kontrak" yang lebih sempit (aktif DAN berakhir dalam kuartal kalender berjalan) — didokumentasikan secara eksplisit di `FaqContent.tsx:376-391`.

## 6. Konsep PSSP

- **PSSP** adalah program standarisasi/kontrak yang dapat diikuti dokter per produk. `PsspKontrak` (`prisma/schema.prisma:472-516`) menyimpan data kontrak historis/aktual (`biaya`, `estBaris`, `totalEst/totalBm/totalLunas`, breakdown per-periode JSON) — diimpor dari snapshot Excel Pelunasan, 1 baris per `(cUrut, kdProduk)`.
- PSSP yang **direncanakan** di POA bersifat TERPISAH: `PoaLineItem.persenPsspDokter × pengaliNilaiR × rencanaTotalBiaya` dihitung fresh per rencana, bukan dibaca dari `PsspKontrak`.
- `JenisPssp` enum (`schema.prisma:58-63`): PSSP / PSSP_RETENSI / PSSP_PEREMAJAAN / PSSP_PERPANJANGAN — saat ini disembunyikan di UI (`schema.prisma:83-85`).
- `PihakPssp` (`schema.prisma:70-73`): USER/KPDM — hanya label, tidak mengubah formula.
- `PsSp` (`schema.prisma:78-81`): klasifikasi PS/SP level-dokter, makna bisnisnya "belum jelas" per komentar schema-nya sendiri.
- `BentukPssp` (`schema.prisma:86-90`): CASH/BARANG/JASA — bentuk kesepakatan PSSP, level-dokter.
- `PsspHospinetSnapshot` (`schema.prisma:198-227`) — sumber PSSP fallback yang lebih kasar untuk divisi (mis. Hospinet) yang tidak memiliki detail level-kontrak — sengaja dibuat sebagai model terpisah dari `PsspKontrak`, bukan dipaksakan ke bentuk yang tidak cocok.

## Open questions / catatan yang belum settled

- `PsSp` enum (PS/SP level-dokter) — makna bisnisnya masih belum jelas per komentar schema sendiri (`schema.prisma:78-81`). ❓
- `JenisPssp` (PSSP/PSSP_RETENSI/PSSP_PEREMAJAAN/PSSP_PERPANJANGAN) disembunyikan dari UI, tetapi field & logic-nya dipertahankan untuk re-enable di masa depan — belum ada kejelasan kapan/apakah akan dipakai lagi. ❓
