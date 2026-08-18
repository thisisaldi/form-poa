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

⚠️ Langkah 3 adalah ASUMSI KERJA, bukan konfirmasi dari dokumentasi API resmi — didasarkan pada 1 sample (NSM P250162 + salah satu ASM di bawahnya) yang konsisten, tapi belum divalidasi terhadap keseluruhan 375 employee atau edge case seperti orang yang subtree-nya kosong/ambigu (lihat OQ-1).

## 4. Perbedaan operasional dari sync MSSQL

- **Arah fan-out terbalik**: MSSQL — 1 query, tiap baris sudah lengkap chain-nya. Nexus — perlu 2 tahap (`get_employees` sekali untuk daftar lengkap + N panggilan `get_subordinates` untuk yang bukan FF) untuk merekonstruksi hierarki yang sama.
- **Cakupan `project`**: MSSQL saat ini query `Divisi = 'KAM1' OR Divisi LIKE 'HPH%'` — DUA kelompok divisi. Belum diverifikasi apakah `project=ethical` di Nexus mencakup KEDUANYA atau cuma salah satu (lihat OQ-2, BLOCKING).
- **Tidak ada indikasi status aktif/nonaktif** di response `get_employees` — MSSQL sync saat ini menandai `isActive=false` untuk NIP yang hilang dari hasil query terbaru (deactivate-by-absence). Perlu dikonfirmasi apakah pola yang sama berlaku aman untuk Nexus (lihat OQ-3).

## 5. Open questions — status & assumptions dipakai untuk v1

| # | Pertanyaan | Asumsi kerja | Siapa yang konfirmasi |
|---|---|---|---|
| OQ-1 (BLOCKING) | Apakah algoritma "closest enclosing ancestor" (§3) untuk rekonstruksi `nipAtasan` valid untuk SELURUH 375 employee, termasuk edge case (orang tanpa ancestor manapun, orang yang subtree-nya sama persis dengan 2 ancestor berbeda karena data API tidak konsisten)? | Divalidasi cuma pada 1 sample (NSM + 1 ASM di bawahnya) yang konsisten. Perlu dry-run penuh (bandingkan hasil inferensi vs `User.nipAtasan` hasil MSSQL sync yang sudah ada sekarang, cari selisihnya) sebelum dipakai produksi. | Pengguna — apakah dry-run/comparison ini cukup, atau perlu validasi manual tambahan dari tim org/HR |
| OQ-2 (BLOCKING) | Apakah `project=ethical` di Nexus mencakup SEMUA employee yang saat ini masuk `Divisi = 'KAM1' OR Divisi LIKE 'HPH%'` di MSSQL, atau cuma sebagian (mis. cuma KAM1, HPH punya `project` lain)? | Belum ada asumsi — TIDAK BOLEH cutover sebelum ini dicek, karena kalau HPH tidak tercakup, sebagian user akan hilang/ter-deactivate salah saat migrasi. | Pengguna — apakah ada `project` lain yang perlu di-fetch juga selain `"ethical"` |
| OQ-3 | Apakah "employee hilang dari `get_employees` = nonaktif" itu asumsi yang aman (sama seperti pola MSSQL sekarang), atau Nexus punya semantik lain (mis. cuti panjang tapi tetap aktif tidak akan muncul)? | Ikuti pola MSSQL yang sudah ada (deactivate-by-absence) sampai ada info sebaliknya. | Pengguna/stakeholder Nexus |
| OQ-4 | `GM` tidak muncul di 375 sample "ethical" — apakah GM memang tidak ada di Nexus sama sekali (tetap dari `importStrukturVerifiedKAM.ts`, TIDAK ikut migrasi ini), atau GM ada tapi di bawah `project` lain? | GM TETAP di luar scope migrasi ini (non-goal, sama seperti `ADMIN`/`SFE`/`VIEWER` sekarang). | Pengguna — konfirmasi non-goal ini eksplisit |
| OQ-5 | Cutover penuh (matikan MSSQL sync total, sama seperti pendekatan `outletSync.ts`) atau jalan paralel dulu (bandingkan hasil, belum menggantikan) untuk beberapa siklus sync sebelum dipercaya penuh? | Mengingat approval chain adalah bagian paling sensitif di app ini (riwayat bug nyata: fix `isActive` check di `resolveNextHolder`, commit terbaru) — rekomendasi kerja: jalan paralel/dry-run dulu, BUKAN cutover langsung seperti outlet. | Pengguna — keputusan risk tolerance |
