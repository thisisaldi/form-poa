# Org Structure Nexus Migration — Business Rules

Sumber requirement: `README.md` §"Sumber requirement" pada folder ini (chat 2026-08-18).

## 1. State saat ini (MSSQL, `orgStructureSync.ts`)

`Struktur_Marketing_PI` — satu baris per outlet assignment, `WHERE Divisi = 'KAM1' OR Divisi LIKE 'HPH%'`, kolom `NSM_NIP/SM_NIP/ASM_NIP/SPV_NIP/FF_NIP` per baris **sudah memuat rantai manager lengkap eksplisit** (tidak perlu inferensi). Mapping role: `NSM→NSM, SM→SM, ASM→ASM, SPV→MR, FF→MR` — SPV dan FF sama-sama `Role.MR` (`User.jabatan` dipakai untuk override display title "SPV", role sebenarnya tetap MR — `docs/TODO.md` #1). FF & SPV keduanya melapor ke ASM langsung (level SPV di-skip untuk rantai approval). `GM`/`ADMIN`/`SFE`/`VIEWER` TIDAK muncul dari sync ini sama sekali — dikelola manual/script terpisah (`importStrukturVerifiedKAM.ts` untuk data GM, lihat `docs/TODO.md` #1).

## 2. Eksplorasi API Nexus (live, terverifikasi 2026-08-18)

### `GET /api/r/poa/get_employees?project=ethical`

Param `project` **wajib** — nilai yang benar `"ethical"` (dikonfirmasi pengguna 2026-08-18; nilai lain yang dicoba sebelumnya — `century`, `pharos`, `marketing-insight` — semua balik `total_data: 0`, bukan error, jadi param salah gagal senyap, bukan error keras).

Response (375 employee untuk project ini):
```json
{
  "nip": "L260392",
  "nama": "AAM AHYAL HAMDANI",
  "zones": [{ "code": "984", "name": "BANDUNG UTARA", "type": "area", "project": "ethical" }],
  "position": "Area Sales Manager"
}
```

- **Tidak ada field manager/atasan langsung** di response ini — cuma `zones` (wilayah + `type`) dan `position` (judul jabatan).
- `position` yang teramati: `Field Force`, `Supervisor`, `Area Sales Manager`, `Sales Manager`, `National Sales Manager`. Tidak ada `"General Manager"` di data 375 baris ini.
- `zones[].type` yang teramati: `territory` (FF), `subarea` (Supervisor), `area` (ASM), `region` (SM), `district` (NSM) — setiap employee di sample HANYA punya 1 zone (`employees dengan >1 zone: 0` pada eksplorasi ini, tapi bukan berarti field ini secara skema selalu single — array-nya tetap perlu ditangani sebagai list).

### `GET /api/r/poa/get_subordinates?nip={nip}`

**Koreksi terhadap catatan lama** (`docs/outlet-nexus-migration/README.md:12` menyebut ini "daftar bawahan langsung" — SALAH). Tes live:

- `get_subordinates?nip=P250162` (NSM, position "National Sales Manager") → 21 orang, campuran SM/ASM/Supervisor/FF dalam satu list datar (bukan cuma level SM di bawahnya).
- `get_subordinates?nip=P220106` (salah satu ASM di list 21 orang di atas) → 3 orang: {Supervisor, Field Force, Supervisor} — dan ketiganya SUDAH ADA di list 21 orang milik NSM di atas.

Kesimpulan: `get_subordinates(X)` mengembalikan **seluruh subtree transitif** di bawah `X` (semua level, bukan cuma direct report), dan hasilnya konsisten dengan hubungan containment (subtree ASM ⊂ subtree NSM-nya). Endpoint ini **tidak** memberi tahu siapa atasan LANGSUNG dari tiap orang — cuma "siapa saja yang ada di bawah saya, sampai level manapun".

## 3. Algoritma rekonstruksi `nipAtasan` (usulan kerja, lihat OQ-1)

Karena tidak ada field manager eksplisit dari kedua endpoint, `nipAtasan` per orang diinferensi:

1. Panggil `get_subordinates?nip=X` untuk setiap `X` yang PUNYA kemungkinan bawahan (posisi selain `Field Force` — FF secara definisi daun/leaf, tidak punya bawahan). Untuk 375 employee "ethical", ini kira-kira employee dengan posisi Supervisor/ASM/SM/NSM saja — jauh lebih sedikit dari 375, sehingga fan-out realistis dengan concurrency yang sama seperti `outletSync.ts` (10 paralel, timeout 5 detik, 1x retry).
2. Untuk tiap orang `Y`, kumpulkan semua `X` di mana `Y ∈ subordinates(X)` — ini "seluruh ancestor" `Y`.
3. Atasan LANGSUNG `Y` = ancestor `X` dengan **subtree TERKECIL** yang masih memuat `Y` (yaitu: tidak ada ancestor lain `X'` sedemikian sehingga `X ∈ subordinates(X')` — kalau ada, `X'` bukan atasan langsung, `X` yang lebih dekat). Setara dengan "closest enclosing ancestor" pada struktur containment set.
4. **Skip level Supervisor untuk rantai approval** — samakan dengan aturan MSSQL saat ini ("SPV & FF sama-sama melapor ke ASM langsung, skip level SPV") supaya rantai approval `MR→ASM→SM→NSM` tidak berubah perilaku hanya karena sumber datanya pindah. Artinya: kalau atasan langsung hasil inferensi seorang FF adalah seorang Supervisor, `nipAtasan` FF itu di-set ke atasan langsung SI SUPERVISOR (satu level di atas), bukan Supervisor itu sendiri — persis pola `collect(row.FF_NIP, ..., row.ASM_NIP)` di kode MSSQL sekarang.
5. Mapping `position` → `Role`: `Field Force→MR`, `Supervisor→MR` (dengan `User.jabatan` override "SPV", identik pola lama), `Area Sales Manager→ASM`, `Sales Manager→SM`, `National Sales Manager→NSM`. `GM`/`ADMIN`/`SFE`/`VIEWER` TETAP di luar scope sync ini (tidak berubah dari perilaku sekarang).

🟢 **Langkah 3 divalidasi penuh 2026-08-18** (bukan cuma dari dokumentasi API resmi, karena memang tidak ada dokumentasi resmi untuk perilaku ini — divalidasi dengan dry-run nyata). Dry-run terhadap SELURUH 375 employee: 0 orang tanpa ancestor (di luar NSM, yang memang seharusnya tidak punya), 0 ancestor yang ambigu/tied. Hasil inferensi `nipAtasan` (dengan langkah 4, skip-Supervisor, sudah diterapkan) dibandingkan terhadap `nipAtasan` hasil MSSQL sync yang sudah berjalan sekarang: **197/198 cocok (99.5%)**. Satu-satunya selisih (`L260349 ANDINI TRISNA BEYLA`, Field Force) sepenuhnya karena gap data yang sudah tercatat di OQ-2 (atasan MSSQL-nya, `P210608`, adalah salah satu dari 3 NIP yang belum ada di Nexus) — bukan bug algoritma. Lihat OQ-1 untuk status akhir.

## 4. Perbedaan operasional dari sync MSSQL

- **Arah fan-out terbalik**: MSSQL — 1 query, tiap baris sudah lengkap chain-nya. Nexus — perlu 2 tahap (`get_employees` sekali untuk daftar lengkap + N panggilan `get_subordinates` untuk yang bukan FF) untuk merekonstruksi hierarki yang sama.
- **Cakupan `project`**: MSSQL saat ini query `Divisi = 'KAM1' OR Divisi LIKE 'HPH%'` — DUA kelompok divisi tertulis di kode. **Temuan langsung ke MSSQL production 2026-08-18**: untuk periode berjalan (202608), `Divisi LIKE 'HPH%'` menghasilkan **0 baris** — divisi yang aktif sekarang cuma `GOP1` (1), `KAM1` (7588 baris outlet-assignment), `MTC2` (3390), `OMG1` (56706), `VBR` (445); filter `HPH%` di kode saat ini secara efektif no-op untuk data saat ini. Lihat OQ-2 untuk hasil perbandingan penuh terhadap Nexus.
- **Tidak ada indikasi status aktif/nonaktif** di response `get_employees` — MSSQL sync saat ini menandai `isActive=false` untuk NIP yang hilang dari hasil query terbaru (deactivate-by-absence). Perlu dikonfirmasi apakah pola yang sama berlaku aman untuk Nexus (lihat OQ-3).

## 5. Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Asumsi kerja | Siapa yang konfirmasi |
|---|---|---|---|
| OQ-1 (RESOLVED) | Apakah algoritma "closest enclosing ancestor" (§3) untuk rekonstruksi `nipAtasan` valid untuk SELURUH 375 employee? | **Dry-run penuh dijalankan 2026-08-18** — 197/198 `nipAtasan` hasil inferensi cocok dengan hasil MSSQL sync yang berjalan sekarang (99.5%), 0 employee tanpa ancestor, 0 ancestor ambigu. Satu-satunya selisih sepenuhnya dijelaskan oleh gap OQ-2 (bukan bug algoritma). Catatan implementasi: draft awal algoritma sempat salah arah (memilih ancestor TERJAUH bukan TERDEKAT) sampai divalidasi dengan dry-run ini — bukti kenapa validasi terhadap data nyata (bukan cuma baca logika) penting sebelum dipercaya. | — sudah terjawab lewat data |
| OQ-2 (RESOLVED, low residual risk) | Apakah `project=ethical` di Nexus mencakup SEMUA employee yang saat ini masuk `Divisi = 'KAM1' OR Divisi LIKE 'HPH%'` di MSSQL? | **Dicek langsung 2026-08-18** — diff NIP set MSSQL `Divisi='KAM1'` periode 202608 (365 NIP non-vacant, semua level) vs Nexus `get_employees?project=ethical` (375 NIP): **362 overlap (99.2%)**. 3 NIP di MSSQL tidak ada di Nexus (`L250504`, `P210608`, `P260292` — dicek, ketiganya level SPV/ASM/FF, bukan NSM/SM, kemungkinan besar cuma selisih waktu snapshot, bukan gap struktural project). 13 NIP ADA di Nexus tapi belum di MSSQL periode ini (kemungkinan Nexus lebih up-to-date / karyawan baru yang belum masuk snapshot MSSQL bulan ini). `HPH%` sendiri sekarang 0 baris di MSSQL (lihat §4) jadi non-isu. Kesimpulan: `project=ethical` sendirian sudah cukup, tidak perlu `project` tambahan. | — sudah terjawab lewat data, tidak perlu konfirmasi pengguna lagi kecuali mau audit manual 3 NIP yang selisih |
| OQ-3 (RESOLVED) | Apakah "employee hilang dari `get_employees` = nonaktif" itu asumsi yang aman (sama seperti pola MSSQL sekarang), atau Nexus punya semantik lain (mis. cuti panjang tapi tetap aktif tidak akan muncul)? | **Dikonfirmasi pengguna 2026-08-20**: ikuti pola MSSQL yang sudah ada (deactivate-by-absence). | Pengguna — dikonfirmasi |
| OQ-4 (RESOLVED) | `GM` tidak muncul di 375 sample "ethical" — apakah GM memang tidak ada di Nexus sama sekali (tetap dari `importStrukturVerifiedKAM.ts`, TIDAK ikut migrasi ini), atau GM ada tapi di bawah `project` lain? | **Dikonfirmasi pengguna 2026-08-20**: GM TETAP di luar scope migrasi ini (non-goal, sama seperti `ADMIN`/`SFE`/`VIEWER` sekarang). | Pengguna — dikonfirmasi |
| OQ-5 (RESOLVED) | Cutover penuh (matikan MSSQL sync total, sama seperti pendekatan `outletSync.ts`) atau jalan paralel dulu (bandingkan hasil, belum menggantikan) untuk beberapa siklus sync sebelum dipercaya penuh? | **Dikonfirmasi pengguna 2026-08-20**: jalan paralel/dry-run dulu (bandingkan hasil Nexus vs MSSQL beberapa siklus sync, BELUM dipakai untuk approval chain sungguhan), baru cutover kalau sudah stabil — BUKAN cutover langsung seperti outlet. | Pengguna — dikonfirmasi |
