# Target Non-Hospital Value — Business Rules

Sumber: permintaan user (chat, 2026-09-11) — "ada target value untuk tim non hospital (omega)... ambil kolom TARGET 202608 (PENGAJUAN), TARGET 202609 (PENGAJUAN)... assign ke GT nya biar kalau yang megang GT nya berubah jadi bisa mengikuti".

## Sumber data

`internal/Target Non-Hospital (In Value).xlsx` — satu sheet per area (CIREBON, BANDUNG, ..., DEPOK; 26 area sheet, dikonfirmasi via `ExcelJS.eachSheet`, 2026-09-11). Sheet lain (GUIDELINE, Area, MEMO, Target by Area (*), TEMPLATE, ActiveRetail, ActiveGrosirPBF, STRUKTUR) bukan sumber data per-area, dilewati.

Tiap area sheet berisi 2 blok berulang (dipisah baris kosong), masing-masing dengan header row sendiri:

| Blok | Header col A | Divisi |
|---|---|---|
| 1 | "GT OUTLET NON DORMANT RETAIL" | `RETAIL` |
| 2 | "GT OUTLET NON DORMANT PBF DAN GROSIR" | `GROSIR_PBF` |

Kolom yang dipakai per blok (row header ada di row "NAMA GT" tepat di bawah baris divisi/approval):

| Kolom | Isi | Dipakai? |
|---|---|---|
| A | NAMA GT | ya — jadi `namaGT` |
| B | NAMA FF (formula XLOOKUP ke sheet STRUKTUR, ExcelJS expose `.value.result` untuk formula cell) | ya — jadi `namaMR` (field bernama `namaMR` disamakan dgn `TargetHospitalValue` walau sumbernya "FF", supaya konsisten lintas tabel) |
| C | NAMA SM (formula XLOOKUP juga) | ya — jadi `namaSM` |
| J | TARGET 202608 (PENGAJUAN) | ya — periode `202608` |
| K | TARGET 202609 (PENGAJUAN) | ya — periode `202609` |
| lainnya (D-I, L-S: sales actual, rekomendasi HO, growth %, approval checkbox) | tidak dipakai — sama filosofi dgn hospital import: hanya kolom Pengajuan yang jadi sumber target |

Baris data berhenti di baris "TOTAL" (col A = "TOTAL") atau baris kosong (col A kosong) — sama pola deteksi row dengan `importTargetHospitalValue.ts`.

Blank/non-numeric cell di kolom J/K berarti periode itu belum diajukan — **skip row untuk periode itu**, bukan dianggap 0 (identik dengan aturan hospital: "pengajuan apa adanya, approved atau belum", tidak ada fallback ke Rekomendasi HO).

## Periode

Hanya 2 periode tersedia di sumber: `202608`, `202609` (beda dari hospital yang punya 202607-202612 — sumber Excel non-hospital ini memang cuma py punya 2 kolom Pengajuan). `TARGET_NON_HOSPITAL_PERIODS = ["202608", "202609"]`.

## Resolusi "siapa pemegang GT saat ini" (live, bukan snapshot)

**Beda mekanisme dari hospital.** Hospital pakai `Outlet.namaGT` + `MrOutletAssignment` (tabel assignment terpisah, disinkron per bulan). Non-hospital (project `OMEGA`) TIDAK punya `Outlet`/`MrOutletAssignment` — assignment wilayah langsung nempel di `User.namaWilayah`/`User.kodeWilayah` (disinkron oleh `omegaUserSync.ts`, lihat komentar schema baris 148-151: "Territory assignment ... MR → GT, SPV (MR) → Sub, ASM → Area, SM → Reg").

Dikonfirmasi by query DB langsung (2026-09-11): `User.namaWilayah` untuk role MR project OMEGA berisi nama persis format sama dengan kolom "Nama GT" sumber Excel (contoh: `"CIREBON 06"`, `"BANJARMASIN 02"`, `"DEPOK 02"` — match langsung, tanpa normalisasi seperti `normalizeGTName` di hospital).

Maka resolusi live pemegang GT untuk non-hospital = **`User.findFirst({ where: { project: "OMEGA", role: "MR", isActive: true, namaWilayah: <namaGT> } })`** — tidak perlu tabel assignment terpisah, tidak perlu fuzzy name matching. Ini LEBIH SEDERHANA dari hospital karena struktur datanya memang beda (namaWilayah itu sendiri SUDAH live, di-update tiap sync — beda dgn Outlet.namaGT yg juga live tapi butuh join lewat assignment table karena satu outlet bisa dipegang MR manapun).

Baris "GROSIR ..." di sumber (divisi `GROSIR_PBF`) sering VACANT (dikonfirmasi 2026-09-11: query `namaWilayah contains "GROSIR"` di tabel User project OMEGA — hasil kosong, tidak ada live holder tersinkron untuk territory grosir manapun saat ini). Ini valid, bukan bug — sama seperti hospital, GT vacant tetap boleh punya target, `nipMR` null di baris hasil resolusi.

## Divisi source (query filter)

`?kategori=RETAIL` atau `?kategori=GROSIR_PBF` (case-insensitive), omit = semua kategori. Dinamai `kategori`, bukan `divisi` — `?divisi` sudah dipakai `/api/target-value` (nama endpoint yang dipakai ulang, lihat "Endpoint" di bawah) untuk memilih hospital vs non-hospital.

## Endpoint (revisi 2026-09-11)

Awalnya dirancang sebagai route terpisah `/api/target-value-non-hospital`. Direvisi user jadi digabung ke `GET /api/target-value` yang sudah ada, dipilih lewat `?divisi=hospital` (default)/`?divisi=non-hospital` — satu endpoint, dua tabel backing, karena shape query/auth/response-nya memang sudah identik. Lihat `docs/API.md` untuk kontrak lengkapnya.

## Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Asumsi v1 | Perlu konfirmasi dari |
|---|---|---|---|
| 1 | Apakah `User.namaWilayah` SELALU persis sama format dgn "Nama GT" sumber (tanpa perlu alias table spt hospital)? | Ya, dikonfirmasi lewat sampling DB (namaWilayah MR OMEGA cocok literal dgn beberapa nama GT sumber) — TAPI belum di-cross-check 100% baris (661 user OMEGA vs ~1000 baris GT source per sheet). Import script akan log GT yang tidak match user manapun (nipMR null), sama seperti hospital handle VACANT. | business/target team, kalau angka NOT_FOUND banyak di production |
| 2 | Apakah endpoint ini perlu dipakai eksternal (Basic Auth, sama seperti `/api/target-value`)? | Ya, disamakan (kredensial `PoaDoctorsApiCredential` yang sama, pola sama) — lebih murah drpd bikin kredensial baru, dan pola ini sudah established. | — (asumsi teknis, low risk) |
| 3 | Role apa yang boleh akses (`?nip=` rollup)? | Sama seperti hospital: MR/ASM/SM/NSM (`SUPPORTED_ROLES`), session dibatasi NSM/ADMIN, NSM dipaksa nip sendiri. TIDAK ada per-role scoping tambahan karena tidak ada model ASM/NSM eksplisit di sumber data (lihat `02-data-model.md`). | — |
| 4 | Apakah butuh UI admin utk edit manual (spt `TargetHospitalValueForm.tsx`)? | Tidak, user cuma minta "get target-value" + query by divisi — tidak diminta UI. Non-goal v1, lihat `03-ui-and-access.md`. | user, kalau ternyata dibutuhkan |
