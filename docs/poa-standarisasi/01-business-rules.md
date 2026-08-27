# POA Standarisasi — Business Rules

Sumber: `source/README_INTEGRASI.md` (tabel "Field mapping ke keputusan bisnis sebelumnya" dan revisi-revisi lanjutannya di dokumen asli yang dilampirkan pengguna 2026-08-13) + `source/Preview_UI_POA_Standarisasi_v12.html`.

## §1. Konsep dasar & apa yang di-reuse

**POA = Plan of Action.** Koreksi 2026-08-14: sumbu utama **POA Estimasi = Dokter × Produk** (bukan Dokter × Outlet seperti sempat ditulis salah di revisi sebelumnya dokumen ini) — satu `PoaLineItem` = 1 dokter × 1 produk; Outlet cuma atribut yang menempel ke dokternya (`kodePI`/`namaOutlet` di baris yang sama), bukan sumbu baris terpisah. **POA Standarisasi = Produk × Outlet** — satu produk, di-scope ke satu outlet lewat satu `PoaStandarisasi` per outlet, dengan dokter jadi sub-entity pendukung di bawah tiap produk (bukan sumbu baris).

| Konsep | POA Estimasi (existing) | POA Standarisasi (baru) |
|---|---|---|
| Unit baris utama | **Dokter × Produk** (`PoaLineItem` = 1 dokter × 1 produk; `PoaDoctorApproval` mengelompokkan semua baris produk milik 1 dokter jadi 1 unit approval) | **Produk × Outlet** (`PoaStandarisasiProduk` = 1 produk dalam 1 pengajuan/outlet; dokter jadi sub-entity pendukung di bawahnya, `PoaStandarisasiDokterApproval` cuma checklist TTD per produk — bukan unit approval utama) |
| Periode | `periodeAwal` (YYYYMM) + `lamaPeriode` (1/3/6/12 bulan) | **Sama persis** — reuse `formatPeriodeRange()`/`expandPeriodeMonths()`/`computeMonthlyBreakdown()` di `src/lib/poaUtils.ts`, tidak ada konsep kuartal baru |
| Formula estimasi | `computeEstimasi()` = `resep/hari × qty/resep × hariKerjaBulan × hargaST × lamaPeriode` (`src/components/poa/LineItemEditor.tsx:285-294`) | Varian: `Jumlah Pasien × Resep per Pasien (ST) × HNA ST` — **tanpa** faktor hari/lama periode (lihat §7 Q4, ini yang jadi open question) |
| Harga & satuan | `hargaST()`/`satuanLabel()` (`LineItemEditor.tsx:203-207`, `:319-322`) | Reuse — jangan duplikasi logic, extract ke helper yang bisa diimpor kedua sisi (lihat catatan desain di `02-data-model.md`) |
| Approval dokter | `PoaDoctorApproval` — approve/reject per dokter di sistem, unit baris utama | Dokter dipilih dari `getCustomersByOutlet()` (sudah ada, `src/app/actions/customer.ts:609`), lalu MR **mencentang** "Sudah TTD" setelah tanda tangan fisik didapat — bukan approval in-app oleh dokter |
| Approval atasan | Chain MR→ASM→SM→NSM, status berjenjang per level (`PoaStatus` enum) | Satu step "Approval Atasan" di tengah wizard yang sama, **blocking**, berhenti di SM (tidak eskalasi ke NSM) — lihat §2/§7 Q2 |
| Golongan kompetitor | `getSurveyRekomendasiInfo(kodeCustomer, kodePI, kodeProduk)` (`customer.ts:763`), dipakai untuk "Produk Kompetitor Utama" di POA Estimasi — **per dokter**, live-derive, tidak disimpan sebagai FK snapshot | "Golongan yang Dipakai Saat Ini" pakai **fungsi & pola yang SAMA persis**, dipanggil per dokter yang dipilih di kartu produk (bukan satu box teragregasi per Outlet+Produk seperti draft awal) — lihat §7 Q1 |
| Spesialisasi dokter (dropdown) | `getCustomersByOutlet()` sudah **Nexus-primary** untuk `spesialisasi` sejak 2026-08-13 (`customer.ts:592-608`, `CustomerOption.spesialisasi` untuk entry yang match Nexus datang dari `nc.spesialisasi`/Nexus `specialist` field, BUKAN kolom lokal `Customer.spesialisasi`) | Dropdown "Dokter Klinis" WAJIB pakai `getCustomersByOutlet()` — **JANGAN** `getCustomersByOutletSpesialisasi()` (`customer.ts:498`, query `where: { customer: { spesialisasi } }` langsung ke kolom DB lokal) untuk apa pun yang menampilkan/memfilter spesialisasi. Pengguna eksplisit: mapping spesialisasi di kolom DB lokal **salah**, jangan dipakai sebagai sumber tampilan (2026-08-14). Catatan: `getCustomersByOutletSpesialisasi` saat ini tidak dipanggil dari mana pun di kode (dead code, diverifikasi grep 2026-08-14) — bukan bug aktif di produksi, tapi jangan dihidupkan lagi untuk fitur ini |
| Data survey/rekomendasi sidebar | `SurveyDataPanel`/`KriteriaProdukPanel` di `LineItemEditor.tsx` | Reuse `getSurveyRekomendasiByOutlet()`/`getKriteriaByOutlet()` (sudah ada, `customer.ts:797`/`:677`), tidak ada action baru untuk data ini |
| Upload dokumen | `SurveyUploadLog` + `uploadFileToSurveyDrive()` (Google Drive via service account, `src/lib/googleDrive.ts:47`) | Pola sama — dokumen NIE/CPOB/KFA/SP Non Sales (download-only) + Form Approval Standarisasi + Surat Approval Standarisasi KFT (upload) |

## §2. Lifecycle — 5 Phase (KOREKSI 2026-08-26, lihat catatan di bawah)

⚠️ Tabel di bawah ini sudah TIDAK akurat dibanding kode aktual (drift dari beberapa iterasi user feedback 2026-08-19 s/d 2026-08-26) — dipertahankan apa adanya untuk histori, koreksi final ada di baris "**Update 2026-08-26**" tiap phase. Urutan phase aktual di kode (`src/lib/poaStandarisasiPhases.ts`): **Planning Standarisasi → Approval Atasan → Approval User/Dokter → Menunggu Meeting KFT → Finalisasi** (5 phase, bukan 4 — "Menunggu Meeting KFT" dipisah jadi step tersendiri).

```
Planning Standarisasi → Approval Atasan → Approval User/Dokter → Menunggu Meeting KFT → Finalisasi → (submit akhir)
```

| Phase | Diisi/dilakukan oleh | Isi |
|---|---|---|
| 1. Planning Standarisasi | MR (pembuat pengajuan) | Outlet, KPDM Standarisasi + Jabatan, Entertain Estimasi (KPDM), Tipe Standarisasi + Periode, Jumlah Bed RS, Target Penyelesaian, N kartu produk (tiap kartu: produk, **Status Pengajuan (Baru/Perpanjangan — per produk, ditambahkan 2026-08-26 docs/TODO.md #12, dipindah dari level pengajuan ke level produk 2026-08-27 atas permintaan user)**, HNA SJ/ST, golongan saat ini, estimasi standarisasi [Jumlah Pasien/Resep per Pasien → Qty/Sales computed], Discount/Biaya Listing/Entertain per produk, Dokter Klinis wajib). **Update 2026-08-26**: sidebar rekomendasi baru (`RekomendasiSidebar`, docs/TODO.md #15) — Data Survey/Produk Rekomendasi/Sudah Standarisasi, semua agregat per outlet-produk (bukan per dokter). |
| 2. Approval Atasan | ASM lalu SM, mengikuti struktur organisasi (`nipAtasan` chain milik MR pembuat pengajuan — resolved, lihat §7 Q3) | Approve/reject pengajuan, **blocking** (resolved 2026-08-14): pengajuan tidak bisa lanjut ke Phase 3 sebelum `statusApprovalAsm` DAN `statusApprovalSm` = `DISETUJUI`, sequential (SM baru bisa bertindak setelah ASM approve — sama pola dengan chain berjenjang POA Estimasi). Eskalasi **berhenti di SM**, tidak lanjut ke NSM. |
| 3. Approval User/Dokter | MR (pembuat pengajuan, melanjutkan wizard yang sama) | **Update 2026-08-26**: dokter di checklist ini sekarang bisa ditambah/dihapus (`addDokterApprovalAction`/`removeDokterApprovalAction`, docs/TODO.md #14), bukan lagi fixed dari Planning. "Sudah TTD" tidak lagi checkbox manual — di-derive dari **upload Bukti TTD** per dokter per produk (docs/TODO.md #8, field baru `PoaStandarisasiDokterApproval.buktiTtdFilePath`/`buktiTtdDriveFileId`). Jadwal Meeting KFT, download dokumen NIE/CPOB/KFA, dan upload "Form Approval Standarisasi" TIDAK LAGI di phase ini (lihat Phase 4/5). |
| 4. Menunggu Meeting KFT | MR | Jadwal Meeting KFT. Browse-only dokumen NIE/COA/CPOB/Flyer per produk (diupload dari tempat lain — lihat `PoaStandarisasiDokumen`; koreksi 2026-08-27, sebelumnya salah dicatat NIE/CPOB/KFA). "Permintaan SP Non Sales" TIDAK di sini, lihat Phase 5. |
| 5. Finalisasi | MR (pembuat pengajuan) | Nama KPDM/Jabatan (readonly dari Planning), Entertain Final (KPDM), upload "Surat Approval Standarisasi KFT" (sekali per pengajuan — lihat §7 Q6), pilih Distributor, per produk: Finalisasi Biaya (Discount Final/Diskon Distributor/Biaya Listing Final) + tabel "Dokter yang Akan Menjadi User" + **Update 2026-08-26**: download "Permintaan SP Non Sales" DAN upload "Form Approval Standarisasi" (keduanya per produk, dipindah ke sini dari Phase 3 lalu Phase 4 — user: konsepnya mirip Surat Approval Standarisasi KFT, sengaja ditaruh berdekatan). Gate submit akhir (`submitPoaStandarisasiAction`) sekarang mewajibkan Form Approval Standarisasi terupload untuk SETIAP produk, selain Surat Approval Standarisasi KFT. |

Catatan: **Phase 1, 3, 4 semuanya diisi progresif oleh MR yang sama** yang membuat pengajuan — bukan diserahkan ke role lain. Satu-satunya titik di mana role LAIN bertindak adalah Phase 2 (ASM/SM). Ini menyederhanakan role/access matrix dibanding dugaan awal dokumen sumber (`canApproveKft` — istilah "KFT" di UI cuma nama dokumen/upload, bukan role approver terpisah; lihat `03-ui-and-access.md`).

"Approval KFT" sebagai PHASE terpisah sempat dihapus lalu direvisi jadi phase "Approval Atasan" (ASM→SM) di iterasi terakhir dokumen sumber (v12) — **field vestigial `SubStatusApprovalKft`/`tanggalSubmitKft`/`tanggalKeputusanKft`/`approvalKftStatus` dari draft sebelumnya SENGAJA TIDAK dibawa ke desain data model di sini** (lihat `02-data-model.md`) karena ini fitur greenfield yang belum ada baris data produksi apa pun — tidak ada alasan menyimpan kolom vestigial di v1.

## §3. Formula

⚠️ **Resolved 2026-08-14 (Q4)**: seluruh field estimasi di bawah adalah nilai **PER BULAN** (bukan potensi total periode) — TIDAK dikalikan `periodeBulan`, beda dengan `computeEstimasi()` POA Estimasi yang mengalikan `lamaPeriode`. Karena ini rawan disalahartikan sebagai total, **setiap label UI & nama field WAJIB mencantumkan "per Bulan"** secara eksplisit (lihat penamaan field di `02-data-model.md` — `estimasiNilaiRpPerBulan`, bukan `estimasiNilaiRp`).

| Formula | Definisi | Sumber |
|---|---|---|
| `estimasiQtyPerBulan` (per produk, Planning) | `jumlahPasien × resepPerPasienSt` | Resolved — nilai per bulan |
| `estimasiNilaiRpPerBulan` (per produk, Planning) | `estimasiQtyPerBulan × hargaST(product)` | sama |
| `estimasiQtyPerBulan`/`estimasiSalesRpPerBulan` (per dokter, Finalisasi) | Formula sama persis dengan level produk (`jumlahPasien × resepPerPasien × hargaST`), dihitung per baris dokter, per bulan | Field baru selaras Planning↔Finalisasi |
| `listingPct` / `entertainPct` (tabel Ringkasan POA) | `biayaListingRp / estimasiNilaiRp × 100`, sama untuk entertain — 0% kalau `estimasiNilaiRp` 0 | Konversi tampilan saja, input tetap Rupiah |
| `totalBudgetPct` (Ringkasan POA per produk) | `discountPct + listingPct + entertainPct` | — |
| `totalBudgetPct` (stat quad level pengajuan, Finalisasi) | `avgDiscountPct + totalListingPct + kpdmEntertainPct + entertainDokterPct` | **Sumbernya BEDA sengaja** dari kolom Entertain% di tabel per-produk (yang tetap dari `estimasiEntertain` Planning) — dikonfirmasi eksplisit oleh penulis dokumen sumber sebagai perbedaan yang disengaja, bukan bug |
| Ambang "OVER BUDGET" | 30% (default penulis dokumen sumber) | ⚠️ belum dikonfirmasi tim bisnis — lihat §7 Q5 |

Semua nilai computed (estimasiQty/estimasiNilaiRp di level produk maupun dokter) **dihitung ulang di server**, tidak dipercaya dari input client mentah — pola yang sama dengan bagaimana `PoaLineItem` formula placeholder columns diisi via server actions, bukan dari body request langsung.

## §4. Enum yang diusulkan

| Enum | Nilai | Catatan |
|---|---|---|
| `PoaStandarisasiPhase` | `PLANNING`, `APPROVAL_ATASAN`, `APPROVAL_USER_DOKTER`, `FINALISASI` | 4 nilai — lihat §2 |
| `TipeStandarisasi` | `PERIODIC`, `SISIPAN`, `PERMANEN` | Periodic & Sisipan wajib isi `periodeBulan` (angka bebas, bukan dari daftar 1/3/6/12 seperti POA Estimasi); Permanen tidak wajib |
| `StatusApprovalAtasan` | `MENUNGGU`, `DISETUJUI`, `DITOLAK` | Dipakai untuk `statusApprovalAsm` dan `statusApprovalSm` masing-masing |
| `DokumenStandarisasiJenis` | `NIE`, `CPOB`, `KFA`, `SP_NON_SALES` | Dokumen download-only per produk |

## §5. Validasi kondisional

- `TipeStandarisasi.PERIODIC` / `.SISIPAN` → `periodeBulan` wajib diisi (integer > 0).
- `TipeStandarisasi.PERMANEN` → `periodeBulan` boleh null.
- Tiap produk: minimal N dokter klinis wajib (mengikuti pola "wajib" existing — jumlah pastinya perlu dikonfirmasi, dokumen sumber contohkan 3 tanpa menyatakan ini aturan tetap atau sekadar contoh data).
- Phase 3: upload "Form Approval Standarisasi" wajib per produk sebelum pengajuan bisa lanjut ke Finalisasi.
- Phase 4: upload "Surat Approval Standarisasi KFT" wajib (cakupan per pengajuan — lihat §7 Q6) sebelum submit akhir.
- Status "✓ Lengkap" per produk di Ringkasan POA dihitung dari kecukupan dokter wajib per produk (bukan field tersimpan, live-derive saat render — pola sama dengan cara Ringkasan POA Estimasi dihitung).

## §6. Non-goals (v1, diusulkan)

- Tidak ada resubmit/reject-per-baris granular seperti `PoaDoctorApproval` reguler — approval dokter di sini murni checklist "sudah TTD" (tanda tangan fisik), bukan approve/reject in-app oleh dokter itu sendiri.
- Tidak ada notifikasi otomatis (email/in-app) saat status Approval Atasan berubah di v1 — ASM/SM harus membuka pengajuannya sendiri untuk melihat & bertindak (approval-nya sendiri tetap blocking, lihat §2/§7 Q2 — ini hanya soal notifikasi).
- Tidak ada halaman approval terpisah untuk ASM/SM — approval terjadi sebagai satu step di wizard yang sama, bukan route baru (dikonfirmasi eksplisit di dokumen sumber sebagai desain yang disengaja).
- Link "+ Buat DPL/DPF baru" tetap placeholder di v1 (lihat §7 Q7) — bukan integrasi nyata ke sistem DPL/DPF eksternal.
- Sync otomatis `Outlet.jumlahBed` dari sumber eksternal — v1 hanya field manual/snapshot (lihat §7 Q8).

## §7. Open questions — status & assumptions dipakai untuk v1

Q1–Q4 adalah blocking dan sudah dijawab pengguna (2026-08-14) — convergence check selesai untuk keempatnya:

| # | Pertanyaan | Jawaban (2026-08-14) | Konsekuensi implementasi |
|---|---|---|---|
| Q1 | `SurveyRekomendasi` keyed per **dokter** — apakah "Golongan yang Dipakai Saat Ini" agregat per Outlet+Produk, atau tetap per dokter? | **Per dokter** — "kayak yang di page input poa yang produk kompetitor", yaitu reuse persis `getSurveyRekomendasiInfo(kodeCustomer, kodePI, kodeProduk)` (`customer.ts:763`) | Tidak ada agregasi lintas dokter, tidak ada FK `surveyRekomendasiId` tersimpan di `PoaStandarisasiProduk` — resolusi live-derive per dokter yang dipilih, sama seperti "Produk Kompetitor Utama" di `LineItemEditor.tsx`. Lihat `02-data-model.md` |
| Q2 | Apakah step "Approval Atasan" **blocking** atau informatif? | **Blocking**, berhenti di SM (tidak eskalasi ke NSM) | State machine `PoaStandarisasiPhase`: transisi ke `APPROVAL_USER_DOKTER` menunggu `statusApprovalAsm` DAN `statusApprovalSm` = `DISETUJUI` |
| Q3 | Siapa approver di Phase 2? | **"Sesuai struktur"** — reuse chain `nipAtasan` milik MR pembuat pengajuan | Approver Phase 2 = ASM langsung dari MR pembuat, lalu SM langsung dari ASM itu — sama mekanisme dengan hierarki `authz.ts` yang sudah ada di seluruh app (termasuk resolusi vacant-team via `Outlet.coveredByNip`/`coveredByRole` bila levelnya kosong) |
| Q4 | Apakah formula estimasi dikalikan `periodeBulan`? | **Tidak** — field-nya murni estimasi **per bulan**, bukan total periode | Formula tidak berubah dari draft awal (`jumlahPasien × resepPerPasien × hargaST`), tapi SEMUA nama field & label UI wajib eksplisit "per Bulan" (`estimasiNilaiRpPerBulan`, dst.) supaya tidak disalahartikan sebagai total — lihat §3 |

Sisanya (Q5-Q9) non-blocking, belum dijawab, jalan dengan asumsi kerja:

| # | Pertanyaan | Blocking? | Asumsi kerja (kalau ada) | Perlu konfirmasi dari |
|---|---|---|---|---|
| Q5 | Ambang "OVER BUDGET" 30% — apakah ini angka bisnis nyata atau placeholder penulis dokumen sumber? | Tidak | 30%, adjustable via config bukan hardcode, supaya gampang diubah tanpa migration | Tim bisnis |
| Q6 | Upload "Surat Approval Standarisasi KFT" — cakupannya per **pengajuan** (satu file untuk semua produk) atau per **produk**? | Tidak (murah diubah — tinggal pindah FK dari header ke `PoaStandarisasiProduk`) | Per pengajuan (field di header `PoaStandarisasi`, bukan di `PoaStandarisasiProduk`) | Tim bisnis |
| Q7 | URL nyata halaman/sistem "+ Buat DPL/DPF baru" | Tidak | `href="#"` / disabled link di v1 | Tim bisnis / tim yang punya sistem DPL/DPF |
| Q8 | Sumber data `Outlet.jumlahBed` — sync dari file eksternal (perlu source file baru) atau input manual per outlet (siapa yang isi, kapan)? | Tidak | Field nullable, diisi manual pertama kali oleh MR di form (auto-suggest ke field snapshot pengajuan `PoaStandarisasi.jumlahBedRs`), tidak ada job sync di v1 | Tim data |
| Q9 | Jumlah minimum dokter klinis "wajib" per produk — angka tetap (mis. selalu 3) atau bervariasi per kondisi (spesialisasi, tipe produk)? | Tidak | Field manual per produk, MR menambah slot dokter sesuai kebutuhan (tidak hardcode 3) — validasi hanya "minimal 1 dokter wajib" sampai dikonfirmasi ada aturan lebih spesifik | Tim bisnis |
