# POA Standarisasi — UI & Access

## Halaman yang diusulkan

| Route | Siapa mengakses | Pola UI di-reuse |
|---|---|---|
| `/poa-standarisasi/new` | MR (pola sama dengan siapa yang bisa `canCreatePoa` reguler — lihat "Role/access matrix" di bawah) | Wizard 4-phase (`Stepper`), `Button`/`Input`/`Card`/`Combobox` dari `src/components/ui/`; server component wrapper memanggil `getOutletsByUser(user.nip)` (pola sama `/poa/new`) + query `Product`, pass sebagai props ke client wizard |
| `/poa-standarisasi/[id]` | Owner (lanjutkan draft) + ASM/SM di chain owner (Phase 2, lihat Q3 di `01-business-rules.md`) | Wizard yang SAMA seperti `/new` (bukan halaman terpisah) — `id` yang ada berarti "lanjutkan pengajuan existing", pola concern sama dengan bagaimana `/poa/[id]` menangani draft-in-progress vs submitted. **Belum dibuat sama sekali di materi sumber** — perlu ditulis dari awal, bukan sekadar drop-in |
| Tidak ada halaman approval terpisah untuk ASM/SM | — | Dikonfirmasi eksplisit di dokumen sumber: approval Phase 2 terjadi SEBAGAI STEP di wizard yang sama saat ASM/SM membuka `/poa-standarisasi/[id]` milik bawahannya (mirror bagaimana approve/reject POA Estimasi bekerja langsung di `/poa/[id]`, bukan route approval terpisah) |

## Dropdown "Dokter Klinis" — sumber spesialisasi

⚠️ Diputuskan eksplisit oleh pengguna (2026-08-14): dropdown dokter di Planning **WAJIB** menggunakan `getCustomersByOutlet()` (`customer.ts:609`, Nexus-primary untuk `spesialisasi` sejak 2026-08-13) — **JANGAN** `getCustomersByOutletSpesialisasi()` (`customer.ts:498`) atau query langsung ke kolom `Customer.spesialisasi` lokal, karena mapping spesialisasi di DB lokal dikonfirmasi salah. Ini berlaku untuk SEMUA tampilan/filter spesialisasi dokter di fitur ini, termasuk kalau nanti ada filter "dokter by spesialisasi" di sidebar. Detail teknis & rationale di `01-business-rules.md` §1 dan `02-data-model.md`.

## Komponen UI baru (lokal ke fitur ini, tidak mengubah shared `ui/`)

Sesuai keputusan eksplisit di dokumen sumber — semua komponen berikut dibuat LOKAL ke folder fitur ini, TIDAK mengubah `src/components/ui/Combobox.tsx` atau komponen shared lain:

| Komponen | Fungsi |
|---|---|
| `CreatableCombobox` | KPDM Standarisasi — combobox dengan opsi "+ Tambah baru" otomatis |
| `JabatanDropdown` | Jabatan — `<select>` asli, bisa nambah baru lewat opsi "+ Tambah Jabatan baru…" yang memunculkan input teks |
| `UnitInput` | Angka + label satuan dalam satu kotak (mis. "3 \| bulan"), dengan varian `readOnly` untuk Estimasi Qty/Sales computed |
| `Summary` / `RingkasanPoa` | Breakdown per produk (stat quad + tabel), mirror `StatsPanel` POA Estimasi tapi detail per produk |
| `ProdukChecklistSidebar` | Sidebar Phase 3 — daftar produk + checker (centang kalau Form Approval Standarisasi sudah diupload) + navigasi klik-pindah produk |
| `RekomendasiSidebar` | Sidebar Phase 1 — 3 pill (Data Survey / Produk Rekomendasi / Produk Sudah Terstandarisasi), reuse data actions existing |

## Role/access matrix

Diturunkan dari pola `authz.ts` yang sudah ada (`getSubordinateMRNips`/`getVisiblePoaFilter`/hierarki `nipAtasan`) — **bukan RBAC baru yang tidak terhubung**, kecuali disebutkan sebaliknya di bawah.

| Role | Bisa membuat pengajuan? | Bisa melihat? | Bisa mengedit Phase 1/3/4? | Bisa approve Phase 2? |
|---|---|---|---|---|
| MR | Ya (outlet yang di-assign ke dirinya, pola sama `getOutletsByUser`) | Pengajuan miliknya sendiri | Ya, selama masih miliknya & belum di phase yang sudah lewat (linear, tidak bisa mundur mengedit phase yang sudah `submittedAt` per phase — lihat catatan state machine di bawah) | Tidak |
| ASM | Tidak — resolved Q3 ("sesuai struktur"): pembuatan pengajuan tetap MR, termasuk pengecualian tim vacant `Outlet.coveredByNip`/`coveredByRole` yang sudah ada (kalau MR outlet itu vacant, ASM/SM bisa jadi owner sesuai cascade yang sama dipakai POA Estimasi) | Pengajuan MR di bawahnya langsung (reuse `getSubordinateIdsUnder(user.nip, 1)` pattern) | Tidak | Ya — approval ASM di Phase 2, **blocking**, untuk pengajuan MR langsung di bawahnya |
| SM | Sama seperti ASM tapi depth 2 (`getSubordinateIdsUnder(user.nip, 2)`) | Pengajuan MR di 2 hop bawahnya | Tidak | Ya — approval SM di Phase 2, **blocking**, HANYA setelah ASM approve (sequential). Eskalasi berhenti di sini — TIDAK diteruskan ke NSM (resolved Q2) |
| NSM | — | Read-only, company-wide-nya di-scope ke subtree sendiri (depth 3), pola sama POA Estimasi | Tidak | Tidak (di luar scope 2 level ASM→SM yang didefinisikan dokumen sumber) |
| ADMIN / GM / SFE / VIEWER | Tidak | Read-only company-wide (pola sama `getVisiblePoaFilter` default case reguler) | Tidak | Tidak |

**Tidak ada role "KFT" terpisah.** Istilah "KFT" di UI (label field "Form Approval Standarisasi" dulunya "Form KFT (Bukti TTD)", "Surat Approval Standarisasi KFT", "Jadwal Meeting KFT") murni nama DOKUMEN/proses eksternal (rapat/persetujuan Komite Farmasi dan Terapi rumah sakit — proses di LUAR sistem), bukan role pengguna sistem ini. Semua field terkait "KFT" diisi oleh MR sebagai bukti/catatan, bukan oleh approver bernama KFT di dalam app. Ini menggantikan asumsi awal dokumen sumber (`canApproveKft` di `authz.ts`) — **tidak perlu authz function baru untuk KFT**, hanya untuk Phase 2 (ASM/SM), yang idealnya di-generalisasi dari pola existing, bukan RBAC baru dari nol.

## State machine (linear, per phase)

Berbeda dari POA Estimasi (yang punya jalur reject/revisi kembali ke DRAFT), wizard ini **linear maju** — MR mengisi Phase 1 → 2 → 3 → 4 berurutan, dengan pengecualian:
- MR bisa kembali membuka phase sebelumnya untuk melihat (tombol "Kembali" di footer / klik step yang sudah "done" di stepper), tapi TIDAK didefinisikan di dokumen sumber apakah field-nya bisa diedit ulang setelah phase itu dianggap selesai — perlu diputuskan saat implementasi (working assumption: field Phase 1 TETAP bisa diedit sampai submit akhir, karena Ringkasan POA yang sama dipakai ulang di Finalisasi menyiratkan data itu belum "dibekukan").
- Phase 2 (Approval Atasan): transisi ke Phase 3 **blocking** (resolved Q2) — `currentPhase` hanya maju ke `APPROVAL_USER_DOKTER` setelah `statusApprovalAsm` DAN `statusApprovalSm` keduanya `DISETUJUI`.
- Tidak ada jalur "reject" yang mengembalikan ke Phase 1 di v1 — kalau ASM/SM menolak (`statusApprovalAsm`/`statusApprovalSm` = `DITOLAK`), penanganannya belum didefinisikan di dokumen sumber (dicatat sebagai gap, bukan diasumsikan — kemungkinan besar pengajuan berhenti/mangkrak di Phase 2 sampai keputusan lanjutan dibuat, tapi ini perlu dikonfirmasi sebelum implementasi menyentuh titik ini).

## Non-goals v1

- Tidak ada notifikasi (email/in-app) saat pengajuan pindah phase atau menunggu approval ASM/SM.
- Tidak ada export Excel untuk POA Standarisasi (POA Estimasi punya `src/app/api/poa/[id]/export/route.ts` — belum ada padanannya di sini, bukan terlewat, memang belum diminta).
- Tidak ada halaman monitoring/summary company-wide untuk POA Standarisasi (kalau dibutuhkan nanti, WAJIB baca `docs/PERFORMANCE.md` dulu — lihat catatan di `02-data-model.md`).
- Tidak ada integrasi nyata ke sistem DPL/DPF eksternal — link "+ Buat DPL/DPF baru" tetap placeholder (lihat `01-business-rules.md` §7 Q7).
- Tidak ada jalur reject/revisi di Phase 2 — lihat "State machine" di atas.
