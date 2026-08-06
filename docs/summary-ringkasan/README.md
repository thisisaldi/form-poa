# Redesain Ringkasan Summary — Spec Index

*(Ditulis 2026-08-05, mengikuti proses di `docs/sdd/`. Sumber requirement: instruksi langsung dari pengguna, disampaikan bertahap dalam beberapa putaran sepanjang sesi kerja tanggal 2026-08-05 — bukan memo eksternal. Awalnya ditulis sebagai spec PROPOSAL sebelum ada kode; sejak v1 diimplementasikan hari yang sama, dokumen ini beralih fungsi jadi dokumentasi retroaktif yang di-update tiap kali ada perubahan — konsisten dengan prinsip `docs/sdd/01-when-and-workflow.md` §3: "kalau pas ngoding ketemu sesuatu yang bikin spec-nya harus berubah, update spec-nya juga".)*

## Dokumen

1. [`01-business-rules.md`](./01-business-rules.md) — definisi istilah, formula tiap section, dan riwayat open questions (sebagian besar sudah terjawab lewat beberapa putaran klarifikasi).
2. [`03-ui-and-access.md`](./03-ui-and-access.md) — lokasi di UI, bentuk tampilan tiap section (tabel vs chart), dampak ke filter, dan non-goals.

Tidak ada `02-data-model.md` terpisah — seluruh section ini murni reorganisasi tampilan + formula baru di atas data yang sudah ada (`PoaLineItem`, `PsspKontrak`, dll — semua sudah didokumentasikan di `docs/form-poa/02-data-model.md`), tidak ada model Prisma baru.

## Status

🟢 **v1 diimplementasikan 2026-08-05, direvisi berkali-kali di hari yang sama** — tab Ringkasan di `/summary` (`src/app/(app)/summary/page.tsx` + `src/components/poa/RingkasanCharts.tsx`). Menggantikan isi section "Isi kartu Ringkasan" yang sebelumnya didokumentasikan sebagai LIVE di `docs/form-poa/03-ui-and-access.md` §3 (cross-reference ⬜→🟢 sudah diberikan di sana).

**Urutan section di tab (2026-08-06, direvisi)**: §4 (tile → Estimasi PSSP per Bulan → Varian Produk Kontes → per-produk-kontes) → §3 → §5. §2 Kesesuaian POA **DIHAPUS sebagai kartu terpisah** (isinya digabung ke §4 dan ke counts-line generik di atas tab — lihat `01-business-rules.md` §2).

**Bentuk tampilan final per section** (berubah beberapa kali dari draft awal — lihat `03-ui-and-access.md` §5 untuk riwayat lengkapnya):
- **§4 Kelompok metrik Value + Unit** — sekarang section PERTAMA. Tile agregat (Target/Estimasi PSSP Rencana/Estimasi PSSP Aktif/**Estimasi PSSP Aktif Q-Sebelumnya** (baru)/Sales/Pelunasan — 6 tile, tadinya 5), header-nya sekarang bawa ikon info "i" (`HeaderInfo`, metodologi tercacah — dipindah dari §2) dan counts-line "N MR · N POA · N pengajuan · Q-Berjalan ..." (juga dipindah dari §2). Ditambah breakdown **per produk kontes individual** dalam bentuk **TABEL** — 27 baris (jumlah produk kontes bervariasi tergantung scope), kolom: Produk, Target, Estimasi Tercacah, Estimasi PSSP Rencana, Estimasi PSSP Aktif, Sales, % Tercacah/Target, % Sales/Target.
- **Estimasi PSSP per Bulan** — **BARU (2026-08-06)**. TABEL, kolom Bulan/PSSP Rencana/PSSP Aktif, 6 baris (window Q-Sebelumnya+Q-Berjalan) — sama bentuk dengan panel "Ringkasan POA" di draft POA (`DraftChecklist.tsx`), di level agregat Ringkasan. **Subsection di dalam kartu §4** (di bawah tile, di atas "Varian Produk Kontes"), bukan kartu terpisah.
- **§3 Pencapaian Target** — chart **horizontal stacked bar** (Target = 100%, PSSP Rencana dan PSSP Aktif ditumpuk sebagai kontribusi masing-masing terhadap Target) — `RingkasanTargetStackedBar`.
- **§5 Breakdown historis** — chart grouped-bar (`RingkasanBarPair`, compact) untuk baris non-komposit, dan grouped-bar bercabang (`RingkasanSplitBarPair`) untuk 2 baris komposit (Breakdown User/KPDM, Baru vs Retensi) yang masing-masing sisi (Rencana/Aktif) sekarang benar-benar dipecah jadi sub-bar, bukan teks chip lagi.

**Tercacah, bukan lagi cuma sebagian (2026-08-06)**: semua figur "Estimasi"/"PSSP Rencana"/"PSSP Aktif" di tab Ringkasan sekarang genuinely tercacah (apportioned) ke kuartal yang sedang difilter — lihat `01-business-rules.md` §2 "Semua Estimasi... TERCACAH" untuk tabel lengkap sumber tiap figur.

**Riwayat framework chart** (detail lengkap di `03-ui-and-access.md` §5): Recharts dipasang lalu **dicopot total** (`npm uninstall recharts`) setelah serangkaian bug (ResponsiveContainer stretch, dumbbell positioning) — diganti hand-rolled SVG mengikuti prinsip `dataviz` skill ("parts assembled in plain HTML/SVG"). Bentuk dumbbell sempat dicoba lalu direvert ke grouped bar chart (matplotlib/seaborn style) atas permintaan eksplisit pengguna. §2 dan §4-breakdown akhirnya diminta jadi tabel biasa, bukan chart sama sekali.

**Belum/tidak dapat dibangun (keterbatasan data model, bukan sekadar belum sempat)**:
- **Target per produk kontes (§4 breakdown per-produk)** — tidak ada breakdown Target per produk di data model manapun. **Untuk role ADMIN saja**, ditampilkan angka dummy deterministik (label eksplisit "(dummy)" + banner peringatan) supaya UI/formula rasio bisa dicek visualnya sebelum data asli ada — role lain tetap "Tidak tersedia". Dikonfirmasi pengguna 2026-08-05: data Target per produk kontes asli AKAN ada di masa depan, dummy ini murni scaffolding sementara, harus dihapus begitu data aslinya tersedia (lokasi persis ditandai di komentar kode `page.tsx`).
- **Target §3 Pencapaian Target** — di banyak POA test data, `poa.target` belum diisi (0). **Untuk role ADMIN saja** (2026-08-06, "di admin tolong pakai target dummy dulu"): kalau Target asli 0, dipakai Target dummy deterministik (`(PSSP Rencana + PSSP Aktif) × 0.7-1.4`, hash dari string kuartal) supaya stacked bar-nya bisa dicek visualnya — label "(dummy)" + banner peringatan. Role lain dan Target asli non-zero tidak terpengaruh. Scaffolding sementara, sama semangat dengan dummy §4 di atas.
- ~~**§3 "PSSP Aktif (Q-Sebelumnya) vs Target"** — memakai figur Aktif yang sama dengan Q-Berjalan~~ — **DIPERBAIKI (2026-08-06)**: §3 sekarang jadi horizontal stacked bar dan memakai figur Rencana+Aktif genuinely per-kuartal, sama pola query yang §2 sudah pakai (lihat `01-business-rules.md` §3) — bukan lagi limitasi terbuka.
- **§2 "PSSP Aktif Q-berjalan/Q-sebelumnya" — SUDAH DIPERBAIKI (2026-08-05, koreksi lanjutan)**: sebelumnya kedua kolom ini salah memakai angka "aktif sekarang" yang sama untuk keduanya. Dikoreksi jadi genuinely per-kuartal — PSSP tercacah (apportioned) yang benar-benar berjalan pada bulan-bulan kuartal itu masing-masing, dihitung dari query baru yang tidak dibatasi ke kontrak yang masih berjalan hari ini. Lihat `01-business-rules.md` §2 untuk formula lengkapnya.
- **§5b Breakdown User/KPDM, dimensi Aktif** — `PsspKontrak` tidak punya field `pihakPssp` sama sekali (field itu cuma ada di `PoaLineItem`). Dimensi Rencana jalan penuh (2 sub-bar User/KPDM); Aktif tetap "Tidak tersedia".
- **§5e Biaya, dimensi Aktif untuk DPL/DPF, DP, Entertain** — `PsspKontrak` hanya punya `biaya`/`estBaris` sebagai angka lump-sum per kontrak, tidak ada field persentase per-komponen seperti `PoaLineItem`. Listing Fee Aktif TETAP dihitung penuh (sumber real terpisah, `ListingFeeKontrak`) dan PSSP Aktif memakai `estBaris` sebagai proxy.

⚠️ **Formula non-blocking yang masih berupa asumsi kerja** (dicatat eksplisit di komentar kode, bukan konfirmasi kata-demi-kata) — detail lengkap di `01-business-rules.md` §"Open questions":
1. Rename "Pengajuan" → "PSSP Rencana" — hanya di section §2-§5 tab Ringkasan, tempat lain di aplikasi tidak disentuh.
2. Filter satu kuartal — tab-scoped (khusus tab Ringkasan), tab lain tetap pakai filter rentang lama.
3. Operator Pencapaian Target (§3) — %, `(PSSP Rencana + PSSP Aktif) ÷ Target × 100`, ditumpuk sebagai stacked bar (direvisi 2026-08-06, lihat `01-business-rules.md` §3).
4. Skop "Jumlah Customer"/"Rata-rata Lama Periode" (§5a-§5b) — company-wide (subtree `mrNips` viewer).
5. Dimensi `Q-Sebelumnya`/`Realisasi` di §5 (13-metrik breakdown, BEDA dari kolom Q-sebelumnya di §2) — masih belum diaktifkan, tetap kandidat perluasan versi berikutnya.

## Ringkasan

Redesain tab "Ringkasan" di halaman `/summary`. Isi final (urutan tampilan):
- Filter periode tab Ringkasan dibatasi hanya boleh memilih **satu** quarter (`Q-Berjalan`), berbeda dari filter Summary di tab lain yang mendukung rentang periode.
- Istilah "Pengajuan" diganti jadi **"PSSP Rencana"** di section ini.
- **§4 (pertama)** — tile agregat Value+Unit, 6 tile: Target/Estimasi PSSP Rencana/Estimasi PSSP Aktif/**Estimasi PSSP Aktif Q-Sebelumnya**/Sales/Pelunasan (semua Estimasi genuinely tercacah), ditambah tabel breakdown per produk kontes individual (Target dummy untuk ADMIN, Estimasi Tercacah per produk, 2 kolom rasio terhadap Target).
- **Estimasi PSSP per Bulan** (subsection di dalam §4, bukan kartu sendiri) — tabel Bulan × PSSP Rencana/Aktif, 6 bulan (window Q-Sebelumnya+Q-Berjalan).
- **§3 Pencapaian Target** — horizontal stacked bar, PSSP Rencana + PSSP Aktif ditumpuk sebagai kontribusi ke Target (=100%), satu bar untuk Q-Sebelumnya dan satu untuk Q-Berjalan; Target dummy khusus ADMIN kalau Target asli belum diisi.
- **§5** — breakdown historis 5 kelompok × 13 metrik turunan sebagai chart grouped-bar, dimensi `Rencana`/`Aktif` (2 baris komposit — Breakdown User/KPDM, Baru vs Retensi — sekarang benar-benar dipecah jadi sub-bar per kategori, bukan teks lagi); dimensi `Q-Sebelumnya`/`Realisasi` sengaja masih ditunda ke versi berikutnya.
- **§2 Kesesuaian POA** — **dihapus** sebagai kartu terpisah (2026-08-06), isinya digabung ke §4 + counts-line generik.
