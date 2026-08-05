# Form POA — Business Rules

*(Retroaktif — didokumentasiin dari kode yang ada, `src/lib/poaWorkflow.ts`, `src/lib/authz.ts`, `src/app/actions/poa.ts`, `prisma/schema.prisma`, `src/components/poa/LineItemEditor.tsx`, `src/components/poa/DraftChecklist.tsx`, `src/lib/poaUtils.ts`. Semua klaim ada file:line-nya.)*

## 1. POA — apa itu & lifecycle

`PoaForm` (`prisma/schema.prisma:143-165`) adalah rencana penjualan 1 MR (atau ASM/SM/NSM pengganti kalau tim MR-nya vacant) buat 1 kuartal (`period`, format `"YYYY-QN"`, divalidasi di `LineItemEditor.tsx:517-524`; dibuat via `createPoaAction`, `src/app/actions/poa.ts:20-40`). Field kunci: `status` (`PoaStatus`), `version` (naik tiap kali balik ke REVISI), `target` (override manual dari atasan, Rupiah), `ownerId`, `currentHolderId` (siapa yang harus bertindak selanjutnya — null kalau masih DRAFT atau udah fully-approved).

### Status (`PoaStatus` enum, `schema.prisma:27-36`)

| Status | Arti |
|---|---|
| DRAFT | Owner masih nyusun, belum ada yang lain terlibat |
| SUBMITTED_TO_ASM | Nunggu review ASM |
| APPROVED_BY_ASM | **Legacy/nyaris gak pernah kejadian** — `approvePoa` sekarang langsung loncat ke status SUBMITTED_TO_ berikutnya (`poaWorkflow.ts:62-67`) |
| SUBMITTED_TO_SM | Nunggu review SM |
| APPROVED_BY_SM | Sama kayak APPROVED_BY_ASM, legacy |
| SUBMITTED_TO_NSM | Nunggu review NSM |
| APPROVED_BY_NSM | Fully approved, `currentHolderId` null |
| REVISI | Balik ke owner, harus direvisi & disubmit ulang |

### State machine (`src/lib/poaWorkflow.ts:15-68`)

- **Submit pertama** (`firstSubmitTransition`, `:47-55`) — target-nya 1 level DI ATAS role owner sendiri. Normal: MR→ASM. Kalau ASM/SM yang jadi owner (kasus tim vacant), loncat ke atasan mereka sendiri.
- **Approve** (`approvePoa`, `:213-232`) — langsung SUBMITTED_TO_ASM→SUBMITTED_TO_SM→SUBMITTED_TO_NSM→APPROVED_BY_NSM, TIDAK ada langkah "submit ke atas" terpisah. Cuma current holder yang boleh manggil (`canApprove`, `authz.ts:353-361`).
- **`resolveNextHolder`** (`:84-95`) — jalan via `nipAtasan` cari user aktif pertama di level target atau di atasnya — otomatis nangkep level yang vacant.
- Tiap transisi nulis `PoaAuditLog` + kirim email (`sendPoaStatusEmail`, `:142-167`).

### Alur khusus

- **Fast-track approve** (`fastTrackApprove`, `:241-260`) — **NSM-only**, loncat status pending manapun langsung ke APPROVED_BY_NSM, skip ASM/SM. Gate: `canFastTrackApprove` (`authz.ts:380-384`), butuh status di `{SUBMITTED_TO_ASM, SUBMITTED_TO_SM, SUBMITTED_TO_NSM}` + POA-nya di subtree NSM itu. Keputusan bisnis (2026-07-23): "NSM bisa langsung approve tanpa harus ke ASM atau SM dulu."
- **Reject** (`rejectPoa`, `:268-288`) — current holder manapun reject → REVISI, wajib isi alasan, `AuditAction.REJECT`.
- **Cancel Approved by NSM** (`cancelApprovedByNsm`, `:300-320`) — NSM batalin approval-nya sendiri → REVISI. Gate: `canCancelApproved` (`authz.ts:393-397`), cuma valid kalau status persis APPROVED_BY_NSM.
- **"Ajukan Edit" (permintaan edit)** — `requestEdit` (`:330-358`): owner minta izin edit ke approver terakhir, cuma nulis log `REQUEST_EDIT`, gak ganti status. `grantEditRequest` (`:368-386`): approver terakhir kasih izin → balik ke REVISI (efeknya sama kayak batalin approval sendiri). `declineEditRequest` (`:393-414`): log `DECLINE_EDIT`, gak ganti status. Gate: `canRequestEdit`/`canRespondEditRequest` (`authz.ts:410-426`).
- **Lock Edit Logic** (`getEditLockLevel`, `authz.ts:245-261`, keputusan bisnis 2026-07-27) — begitu ASM/SM/NSM approve ATAU edit POA yang bukan punya mereka sendiri, semua level di BAWAH level itu kekunci dari edit sampai siklusnya balik ke DRAFT/REVISI. Dideteksi dengan scan `PoaAuditLog` (bukan flag tersimpan) mundur sampai entry DRAFT/REVISI terakhir.
- **`flagRevisionOnEdit`** (`:452-488`) — dipanggil tiap add/edit/delete line item. Kalau belum ada yang approve di siklus ini, edit gak ngaruh ke status (owner bebas benerin sebelum direview). Kalau MR owner edit SETELAH ada yang approve, balik ke REVISI (version++, holder di-clear) — walau normalnya Lock Edit Logic udah nyegah situasi ini kejadian tanpa reject/cancel/grant dulu.

## 2. Line Item

`PoaLineItem` (`prisma/schema.prisma:265-355`) — 1 baris per (dokter × outlet × produk). 3 kelompok field:

- **Customer group** (auto-fill dari lookup `Customer`, `:270-284`): `kodeRequest`, `kodeCust`, `namaCust`, `role`, `spesialisasi`, `isManualCustomer` (true kalau dokternya didaftarin manual, bukan dari sync CDB), `historisPSSP`, `kodePI`, `namaOutlet`.
- **Product group** (auto-fill dari lookup `kodeProduk`, `:285-290`): `kodeProduk`, `namaProduk`, `kategoriProdukFokus`, `itemKode`, `satuanTerkecil`.
- **MR manual input** (`:292-333`): field level-dokter yang diduplikasi di semua baris produk dokter itu — `labelCustomer`, `jenisPsSp` (PS/SP), `bentukPssp` (CASH/BARANG/JASA); field per-produk — `produkKompetitor`, `kriteriaProduk`, `statusStandarisasi`, `jenisPssp`, `pihakPssp` (USER/KPDM, cuma relabel tampilan), `hariKerjaBulan`/`jumlahPasienHari`/`jumlahResepHari`/`qtyProdukResep` (C20-C23, nullable), `lamaPeriode` (1/3/6/12), `periodeAwal` (YYYYMM), `rencanaTotalBiaya`, `rencanaVisitMinggu`, plus field pecahan budget: `rasioEstimasiGrowth`, `persenPsspDokter`, `persenPsspKpdm`, `persenDiskon`, `persenDp`, `persenListingFee`, `persenEntertain`.

1 "dokter" = 1 pasangan `(kodePI, namaCust)` (`doctorKey`, `DraftChecklist.tsx:53-55`) — 1 dokter bisa punya banyak `PoaLineItem` (1 per produk), berbagi field level-dokter yang sama via state `DokterFields` di editor (`LineItemEditor.tsx:120-131`).

## 3. Formula inti

| Konsep | Formula | Sumber |
|---|---|---|
| **Estimasi** (`rencanaTotalBiaya`) | `jumlahResepHari × qtyProdukResep × hariKerjaBulan × (HNA ÷ konversiPembagi) × lamaPeriode`, dibulatkan | `LineItemEditor.tsx:273-282,191-195` |
| **Nilai PSSP** | `rencanaTotalBiaya × persenPsspDokter × pengaliNilaiR` | `DraftChecklist.tsx:140`, `LineItemEditor.tsx:933` |
| **Pengali Nilai R** | Multiplier manual per-dokter atas dasar % Nilai R produk; teks bebas, default `1` kalau kosong (`resolvePengaliNilaiR`, `LineItemEditor.tsx:201-207`). Nilai tampilan level-dokter = rata-rata tertimbang lintas produk by `rencanaTotalBiaya` (`DraftChecklist.tsx:704-717`). |
| **Pihak PSSP** (USER/KPDM) | Cuma switch label tampilan — pilih KPDM ngubah "% PSSP User" → "% PSSP KPDM" di form/export; nilai `persenPsspDokter` & formulanya TIDAK berubah | `schema.prisma:65-73`, `LineItemEditor.tsx:1334` |
| **Total % Budget** | `persenPsspDokter × pengaliNilaiR + persenDiskon + persenDp + persenListingFee + persenEntertain` | `LineItemEditor.tsx:1308-1312` |
| **Threshold Budget** | `>42.5%` = "Melebihi batas"/OVER BUDGET · `38%–42.5%` = "Mendekati batas" · `<38%` = "Aman"/SAFE | `LineItemEditor.tsx:1314,1365`; `export/[id]/export/route.ts:272,623` |
| **Budget agregat** | `budgetTotal = psspTotal + discountTotal + entertainTotal`, `discountTotal` = jumlah `persenDiskon+persenDp+persenListingFee` | `DraftChecklist.tsx:134-155` |
| **Tercacah (apportionment bulanan)** | Dua varian: (a) `computeMonthlyBreakdown` (`src/lib/poaUtils.ts:66-94`) — sebar Estimasi/Nilai PSSP rata ke tiap bulan rencana, jumlahin per bulan kalender — dipakai bareng export & panel Ringkasan & chart Summary. (b) `computeBiayaTercacah` (`DraftChecklist.tsx:57-86`) — apportion total 1 line item ke SEBERAPA BANYAK bulan rencananya yang jatuh di kuartal POA-nya sendiri (misal rencana 6 bulan yang overlap 3 bulan kuartal → keitung 3/6). Masalah yang diselesaikan: `lamaPeriode` (1/3/6/12) jarang pas 1 kuartal, jadi total mentah bakal overstate apa yang beneran direncanain "kuartal ini." |
| **Rasio Estimasi / Target** | `(tercacahEstimasiWithAktif ÷ targetArea) × 100` | `DraftChecklist.tsx:376`, `poa/[id]/page.tsx:239` |
| **Resolusi Target** | `poa.target` (manual, di-set atasan) menang kalau keisi; kalau kosong, diturunin dari `SUM(TargetHospitalValue.target)` selama bulan-bulan kuartal itu, lintas semua MR di bawah owner (`getSubordinateMRNips`) | `poa/[id]/page.tsx:212-238` |
| **Growth Estimasi** | `(newEstPerMonth ÷ latestPsspEstPerMonth − 1) × 100%` — baseline dari kontrak PSSP terakhir (aktif/expired) buat produk yang sama, `estBaris` disebar ke periode kontraknya sendiri (bukan dibagi 3 flat) | `LineItemEditor.tsx:312-341,940-943` |
| **Growth Pelunasan** | `(newEstPerMonth ÷ (latestContractTotalLunas ÷ elapsedMonths) − 1) × 100%` — baseline dari kontrak PSSP terakhir yang beneran ada pelunasannya, dibagi berapa bulan itu BENERAN udah jalan (bukan flat /3) | `LineItemEditor.tsx:361-379` |

Copy warning/apresiasi: Growth ≤0% → "⚠ Intensifikasi kurang"; >0% → "✓ ... pastikan nilainya sudah tepat" (`LineItemEditor.tsx:1199-1241`).

## 4. Sistem Quarter/Periode

- `PoaForm.period` = string kuartal `"YYYY-QN"` (mis. `"2026-Q3"`), di-set sekali pas POA dibuat (`src/app/actions/poa.ts:20-38`).
- Tiap `PoaLineItem` punya `periodeAwal` (YYYYMM) + `lamaPeriode` (1/3/6/12) sendiri; `periodeAkhir` gak pernah disimpan, selalu dihitung `periodeAwal + (lamaPeriode−1)` bulan (`src/lib/poaUtils.ts:12-21`).
- **Quarter picker per baris** (request 2026-07-31, `LineItemEditor.tsx:567-579`) — tiap baris dokter bisa pilih kuartal target-nya SENDIRI, independen dari `period` POA induknya — tahun tetep ngikut tahun POA, tapi kuartalnya bisa beda per baris.

## 5. Klasifikasi Dokter (`labelCustomer`)

`computeLabelCustomer` (`LineItemEditor.tsx:381-405`):
- Gak ada histori PSSP sama sekali → **"Dokter Baru"**.
- Punya ≥1 kontrak yang masih aktif (per kontrak, bukan per produk) → **"Retensi"** (atau "Retensi, Pelunasan Bagus" kalau pelunasan kontrak aktifnya ≥80%).
- Punya histori tapi gak ada yang aktif sekarang → **"Pernah PSSP"** (atau "Pernah PSSP, Pelunasan Bagus" kalau pelunasan lifetime ≥80%).

⚠️ **Bug stale-snapshot (fixed, commit `20dbd41`)**: `PoaLineItem.labelCustomer` ditulis sekali pas line item dibuat, gak pernah dihitung ulang. Kalau kontrak PSSP customer baru sync masuk SETELAH line item-nya dibuat, label yang tersimpan tetep "Dokter Baru"/kosong selamanya. Fix: `DraftChecklist.tsx`'s `DoctorRow` dan export Excel per-POA sekarang nge-override nilai stale itu pakai live check (`everPsspKodeCust`) kapanpun `hasPsspNow` true tapi label tersimpan kosong/"Dokter Baru" — label tersimpan yang udah kaya & konsisten (mis. "Retensi") dibiarin apa adanya.

Catatan: "Retensi" punya 2 arti beda di UI — sense badge Label Customer (≥1 kontrak aktif, tanggal akhir kapanpun) vs sense badge "kartu kontrak" yang lebih sempit (aktif DAN berakhir dalam kuartal kalender berjalan) — didokumentasiin eksplisit di `FaqContent.tsx:376-391`.

## 6. Konsep PSSP

- **PSSP** adalah program standarisasi/kontrak yang bisa diikutin dokter per produk. `PsspKontrak` (`prisma/schema.prisma:472-516`) nyimpen data kontrak historis/aktual (`biaya`, `estBaris`, `totalEst/totalBm/totalLunas`, breakdown per-periode JSON) — diimport dari snapshot Excel Pelunasan, 1 baris per `(cUrut, kdProduk)`.
- PSSP yang **direncanain** di POA itu TERPISAH: `PoaLineItem.persenPsspDokter × pengaliNilaiR × rencanaTotalBiaya` dihitung fresh per rencana, bukan dibaca dari `PsspKontrak`.
- `JenisPssp` enum (`schema.prisma:58-63`): PSSP / PSSP_RETENSI / PSSP_PEREMAJAAN / PSSP_PERPANJANGAN — saat ini disembunyiin di UI (`schema.prisma:83-85`).
- `PihakPssp` (`schema.prisma:70-73`): USER/KPDM — cuma label, gak ngubah formula.
- `PsSp` (`schema.prisma:78-81`): klasifikasi PS/SP level-dokter, arti bisnisnya "belum jelas" per komentar schema-nya sendiri.
- `BentukPssp` (`schema.prisma:86-90`): CASH/BARANG/JASA — bentuk kesepakatan PSSP-nya, level-dokter.
- `PsspHospinetSnapshot` (`schema.prisma:198-227`) — sumber PSSP fallback yang lebih kasar buat divisi (mis. Hospinet) yang gak punya detail level-kontrak — sengaja model terpisah dari `PsspKontrak`, bukan dipaksa masuk bentuk yang gak cocok.

## Open questions / catatan yang belum settled

- `PsSp` enum (PS/SP level-dokter) — arti bisnisnya masih belum jelas per komentar schema sendiri (`schema.prisma:78-81`).
- `JenisPssp` (PSSP/PSSP_RETENSI/PSSP_PEREMAJAAN/PSSP_PERPANJANGAN) disembunyiin dari UI, tapi field & logic-nya dipertahankan buat re-enable nanti — belum ada kejelasan kapan/apakah bakal dipakai lagi.
