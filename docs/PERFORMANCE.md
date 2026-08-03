# Performance — Constraints & Patterns

*(Ditulis 2026-08-03. Tujuan: jadi referensi wajib-baca sebelum nambah query/halaman baru — terutama yang company-wide/ADMIN-scope — supaya kelas bug yang udah pernah kejadian (lihat `docs/TODO.md` #47, fix 07-31) gak keulang lagi. Bukan dokumen aspirational/best-practice generik; semua contoh di sini nunjuk ke kode nyata yang ada sekarang.)*

**Perubahan 2026-08-03 (sesi yang sama, setelah audit lebih dalam):** fix N+1 nyata di `dashboard` (§2 poin 4, `getMrIdsUnder`/`getSubordinateIdsUnder` dibungkus `cache()`) — diverifikasi typecheck bersih. Koreksi klaim index `PoaLineItem` yang ternyata salah setelah dicek ke query asli (§2 poin 6) — jangan ulangi pola "asumsi dari nama kolom tanpa cek `where` beneran".

## 1. Kenapa dokumen ini ada

Riwayat insiden yang udah kejadian di app ini (semua di `docs/TODO.md`, section "Beres 07-31"):

- Summary page tab "Per Outlet" pernah **58-74 detik** untuk scope ADMIN company-wide (#47).
- Login (`findFirst` + `mode: "insensitive"`) forced **Seq Scan** tiap kali orang login.
- Struktur organisasi (`getMrIdsUnder`/`getSubordinateIdsUnder`) tadinya rekursi per-node — puluhan round-trip DB berurutan untuk 1 request.
- Prisma connection pool ikut default `DATABASE_URL` yang di-manage Vault (gak dikontrol harian) — bisa exhaust di traffic normal.
- Summary page fetch SEMUA histori submission tanpa batas periode.

Semua ini **sudah difix**, tapi pola yang sama gampang keulang di fitur baru (paling relevan sekarang: KPI Monitoring, lihat §5). Dokumen ini nangkep pola fix-nya jadi constraint yang harus diikuti dari awal desain, bukan ditambal belakangan.

## 2. Constraint wajib untuk query/halaman baru

Checklist ini berlaku terutama untuk apapun yang bisa diakses **company-wide** (role ADMIN/GM/NSM scope luas) — itu yang bikin masalah tembus ke produksi, bukan query scope-MR-tunggal.

1. **Jangan `findFirst`/`findMany` dengan filter case-insensitive di kolom yang harusnya unique-lookup.** Normalize di aplikasi (`.toUpperCase()`/`.toLowerCase()`), lalu `findUnique` di kolom asli. Contoh yang benar: `src/lib/auth.ts:31-33`.
2. **Jangan rekursi per-node buat traversal hierarki (struktur organisasi, approval chain, dst).** Pakai BFS per-level: satu `findMany` dengan `{ in: [...] }` per level, bukan satu query per orang. Contoh yang benar: `getMrIdsUnder`/`getSubordinateIdsUnder` di `src/lib/authz.ts:43-90` (≤3 query total, level-bounded). Contoh yang **salah** dan masih ada: `src/app/api/users/[nip]/superiors/route.ts:31-41` (`for` loop + `await findUnique` per level) — perlu diaudit/diselaraskan ke pola BFS kalau dipakai jalur yang traffic-nya berarti.
3. **Jangan fetch histori/listing tanpa batas periode default.** Selalu ada window default yang masuk akal (contoh: Summary page = kuartal ini + 1 kuartal sebelumnya, `src/app/(app)/summary/page.tsx:120-177`), dan "lihat semua" harus explicit action (filter/query-param), bukan default page load. Kalau nambah `?size=all` atau setara yang men-drop `skip/take` sepenuhnya (pola di `src/app/(app)/dashboard/page.tsx:54,76`), pastikan itu **bukan** default dan idealnya tetap ada guard (mis. count check / confirm) sebelum benar-benar unbounded.
4. **Jangan query di dalam loop (N+1) untuk data yang bisa di-batch — termasuk N+1 "tersembunyi" lewat helper yang re-derive hal yang sama berkali-kali.** Kalau butuh data per-item dari list (mis. status per POA, per baris personil), kumpulin ID dulu → satu `findMany({ where: { id: { in: [...] } } })` → map di memory. Contoh nyata yang udah difix (2026-08-03): `dashboard/page.tsx:127` manggil `canEdit()` per POA di list (`Promise.all`, sampai `pageSize` baris, unbounded kalau `?size=all`) — dan `canEdit` → `canView` di dalamnya manggil `getSubordinateIdsUnder(actor.nip, depth)` LAGI per POA, padahal `getVisiblePoaFilter(actor)` di baris atasnya udah manggil fungsi yang SAMA dengan args yang SAMA sekali di awal request. Fix: `getMrIdsUnder`/`getSubordinateIdsUnder` (`src/lib/authz.ts:51,83`) dibungkus `cache()` dari `react` — dedup otomatis per request/render (React 19 RSC), bukan ubah logic. ≤3 DB round-trip per request, bukan ≤3 × N baris. **Pola ini (helper hierarki yang dipanggil berkali-kali dengan args sama dalam 1 request) harus dicek tiap kali nambah helper baru di `authz.ts`** — kalau helper itu dipanggil dari dalam loop/`.map()` di caller manapun, bungkus `cache()`.
   - `getEditLockLevel`/`getLastApprover` (`authz.ts:234,262`, tiap POA fetch `poaAuditLog` sendiri) **belum** di-cache — args-nya (`poaId`) unik per baris jadi `cache()` gak akan dedup apa-apa di sana, tetap N query per halaman listing. Kalau `?size=all` dipakai di scope company-wide dan ini kerasa lambat, opsinya: batch semua `poaId` jadi 1 `findMany({ where: { poaId: { in: [...] } } })` lalu group-by di memory (replikasi logic cycle-reset yang sama persis) — belum dikerjakan, catat di sini biar gak lupa kalau muncul laporan lambat dari halaman yang pakai `size=all`.
   - `src/lib/sync/orgStructureSync.ts:137-186` (per-row upsert dalam loop — acceptable untuk sync job batch, TAPI kalau volume row naik signifikan, evaluasi ulang).
5. **Snapshot data yang mahal dihitung & butuh histori stabil — jangan derive on-the-fly tiap render.** Pola ini yang dipakai `PoaAuditLog` dan yang diusulkan `KpiMonthlyEntry` (`docs/kpi-monitoring/02-data-model.md:29-33,66-69`): field `salesTargetRp`/`salesActualRp`/`customerAktifCount`/score per pilar di-snapshot lewat job periodik, bukan re-compute tiap kali halaman dibuka. Aturan turunannya: **kalau ada agregasi company-wide yang dipanggil on-demand dan makin lambat seiring data nambah (bukan seiring traffic), itu kandidat kuat buat di-snapshot**, bukan dioptimasi query-nya doang.
6. **Index kolom yang beneran dipakai di `WHERE`/`JOIN`/`ORDER BY` di tabel besar — jangan nebak dari nama kolom.** *(Dikoreksi 2026-08-03: draft awal dokumen ini sempat nyaranin nambah index `kodeProduk`/`kodeCust`/`spesialisasi`/`periodeAwal` di `PoaLineItem` berdasarkan asumsi "dipakai filter/grouping di Summary" — ternyata SALAH setelah dicek ke kode. Summary/monitoring/export SEMUA query `PoaLineItem` cuma pakai `where: { poaId: { in: [...] } }` — kolom-kolom itu cuma di-`select` lalu di-group DI MEMORY pakai JS, bukan di level DB. Index Postgres gak ngebantu grouping in-memory; nambahinnya cuma nambah write overhead tanpa manfaat baca. Verifikasi: `grep -rn "poaLineItem\.(findMany|findFirst|count|aggregate|groupBy)"` di `src/`, semua `where` yang ketemu cuma pakai `poaId` (sudah ter-index) atau kombinasi sempit dalam 1 `poaId` (`kodePI`+`namaCust`+`kodeProduk`, row count kecil per POA, gak butuh index terpisah).* Pelajaran buat ke depan: **cek `where`-nya di query yang beneran jalan sebelum nambah index, jangan asumsi dari nama field yang di-`select`.**
7. **Connection pool bukan sesuatu yang boleh ke-inherit diam-diam dari environment.** Pool size eksplisit di `src/lib/prisma.ts:24` (`CONNECTION_LIMIT = 50`). Kalau nambah service/worker terpisah yang connect ke DB yang sama, pool budget itu harus dipikirin ulang (jangan asumsi tiap service dapet 50 sendiri-sendiri kalau DB-nya sama).
8. **Gak ada caching layer di app ini sekarang** (`unstable_cache`/`React.cache` — nihil, cuma ada `revalidatePath` buat invalidation). Artinya: setiap agregasi company-wide yang berat itu HARUS cepat di level query/index/snapshot dulu (poin 5-6), jangan andelin "nanti di-cache aja" sebagai rencana — belum ada infrastrukturnya, dan nambahin cache layer itu keputusan arsitektur terpisah, bukan tambal cepat.

## 3. Definisi "cepat cukup"

Belum ada SLA formal tertulis di memo/stakeholder. Sampai ada angka resmi, pakai heuristik ini sebagai constraint kerja:

- Halaman/tabel listing (termasuk company-wide ADMIN scope): target **<3 detik** load pertama.
- **>10 detik = anggap bug**, bukan "wajar karena data banyak" — kasus #47 (58-74 detik) itu bukti kalau dibiarkan tanpa constraint eksplisit, angka ini gampang tembus jauh lebih parah daripada sekadar "agak lambat".
- Kalau desain fitur baru diperkirakan gak bisa masuk target ini dengan pola on-demand query (poin 2 §2), **snapshot/pre-compute itu bagian dari desain awal**, bukan optimization pass belakangan — apalagi kalau fitur itu ADMIN/GM-scope dari awal (lihat §5).

## 4. Checklist sebelum merge fitur baru yang query company-wide

- [ ] Ada window/filter default yang membatasi row yang di-fetch (bukan "semua data" sebagai default)?
- [ ] Lookup by unique identifier pakai `findUnique`, bukan `findFirst` + filter case-insensitive?
- [ ] Traversal hierarki (kalau ada) pakai BFS per-level, bukan rekursi/loop per-node?
- [ ] Gak ada `await prisma.*` di dalam `for`/`.map()` tanpa batching — atau kalau ada, sudah dipertimbangkan (mis. sync job batch yang volumenya emang kecil)?
- [ ] Kolom yang dipakai `WHERE`/`GROUP BY` di tabel besar sudah ter-`@@index`?
- [ ] Kalau agregasinya "makin lambat seiring histori data nambah" (bukan seiring traffic) — sudah dipertimbangkan snapshot model, bukan cuma tuning query?
- [ ] Sudah dites dengan scope ADMIN/company-wide (bukan cuma scope MR single-outlet yang datanya kecil)?

## 5. Aplikasi langsung ke KPI Monitoring (spec aktif, `docs/kpi-monitoring/`)

`02-data-model.md` udah nyinggung ini duluan ("read-only derive on demand... kecuali performa jadi masalah... pola query yang sama harus diwaspadai di sini, terutama kalau KPI Monitoring dibuka company-wide oleh ADMIN/GM") — dokumen ini menjadikannya constraint eksplisit, bukan catatan waspada:

- Sales Achievement & Customer Expansion di v1 masih **derive on-demand** (reuse `buildOrgMaps()`/`getActivePsspByOutlets()`). Ini OK selama halaman masih **ADMIN-only + belum company-wide default** (sesuai `03-ui-and-access.md` §2, v1 access ADMIN-only). **Begitu role matrix target (§1 `03-ui-and-access.md`) dibuka — SM/NSM lihat subtree, GM lihat company-wide read-only — derive on-demand ini WAJIB dievaluasi ulang** terhadap checklist §4 sebelum widen access, bukan setelah ada laporan lambat.
- `KpiMonthlyEntry`/`KpiContractEvaluation` sudah didesain snapshot-first (§2 `02-data-model.md`) — pola ini yang benar, pertahankan; jangan diubah jadi on-the-fly compute demi "simplifikasi" tanpa evaluasi ulang skala data.
- Kalau job bulanan buat isi snapshot `KpiMonthlyEntry` dibangun (disebut di `02-data-model.md:67`), ikuti pola `scripts/sync*.ts` yang udah ada — termasuk pertimbangan N+1 per-row upsert yang sama seperti `orgStructureSync.ts` (§2 poin 4 di atas), diaudit kalau volume personil besar.

## 6. Kalau nemuin pola baru yang melanggar §2

Update dokumen ini (tambah ke watchlist atau checklist), bukan cuma fix diam-diam — biar constraint-nya tetap hidup dan gak ke-drift dari kode aktual. Kalau ada insiden performa baru, catat juga cross-reference-nya di `docs/TODO.md` (pola yang sudah dipakai buat #47).
