# Form POA — UI & Access

*(Retroaktif — didokumentasikan dari `src/lib/authz.ts`, tiap `page.tsx` di `src/app/(app)/`, `src/components/layout/Sidebar.tsx`, kedua route export Excel, dan integrasi eksternal. Semua klaim memiliki referensi file:line.)*

## 1. Resolusi hierarki organisasi & access (`src/lib/authz.ts`)

Single source of truth untuk semua permission check — **jangan membuat RBAC ad-hoc di tempat lain**, generalisasi dari fungsi-fungsi ini.

| Fungsi | Baris | Fungsinya |
|---|---|---|
| `getMrIdsUnder` (private) | 51 | BFS level-by-level, resolve nip MR leaf saja di bawah 1 manager, dibatasi `depth` hop; dibungkus React `cache()` untuk dedup panggilan berulang per-baris dalam 1 request |
| `getSubordinateIdsUnder` (private) | 83 | BFS sama tetapi mengembalikan SEMUA subordinate (termasuk manager perantara) — dibutuhkan karena manager dapat self-own POA (kasus tim vacant) yang tetap harus terlihat oleh atasannya sendiri |
| `getSubordinateMRNips` | 104 | Public: semua nip MR di subtree user. MR→diri sendiri; ADMIN/GM/SFE/VIEWER→semua MR aktif non-dummy company-wide; ASM/SM/NSM→BFS via `getMrIdsUnder` depth 1/2/3 |
| `getVisiblePoaFilter` | 134 | Mengembalikan klausa `WHERE` Prisma untuk scope query list POA per role: MR hanya punya milik sendiri; ASM/SM/NSM punya milik sendiri (status apa pun) + subordinate non-draft; GM/VIEWER/SFE/ADMIN semua (`{}`) |
| `canView` | 203 | Cek per-POA: ADMIN/GM/VIEWER/SFE selalu true; owner selalu true; MR hanya punya milik sendiri; manager butuh subordinate-di-subtree DAN status bukan DRAFT/REVISI |
| `canEdit` | 316 | Menjalankan gate Lock Edit Logic terlebih dahulu, baru: ADMIN selalu; owner selalu; ASM/SM/NSM apabila `canView` lolos. GM dikecualikan total (read-only) |
| `canApprove` | 353 | Lebih ketat dari `canEdit` — ADMIN, atau ASM/SM/NSM hanya apabila mereka current holder (`currentHolderId === user.nip`) |
| `canFastTrackApprove` | 380 | NSM-only: approve langsung ke fully-approved skip ASM/SM, asalkan POA genuinely pending & berada di subtree NSM |
| `canCancelApproved` | 393 | NSM-only: membatalkan approval sendiri, POA harus persis APPROVED_BY_NSM, gate subtree sama |
| `canRequestEdit` | 410 | Hanya owner, hanya apabila sedang terkunci `canEdit`=false DAN sudah ada approval di siklus ini (`hasApprovalThisCycle`) |
| `canRespondEditRequest` | 423 | Hanya orang spesifik yang menjadi approver terakhir siklus ini (via `getLastApprover`) yang boleh grant/decline — bukan sembarang orang di level itu |
| `canCreatePoa` | 444 | Akun dummy & ADMIN selalu boleh. MR boleh apabila tidak punya subordinate + ≥1 outlet assignment. ASM/SM/NSM boleh apabila ≥1 outlet `coveredByNip`=mereka dengan `coveredByRole`≠MR (exception tim vacant) |
| `getPendingActionFilter` | 476 | MR→POA sendiri yang DRAFT/REVISI; manager→POA yang `currentHolderId`=mereka (inbox mereka) |
| `getLastApprover` | 273 | Memindai `PoaAuditLog` secara descending, berhenti di transisi DRAFT/REVISI terakhir, mengembalikan actorId+role dari log APPROVE terakhir siklus ini (atau null) |
| `hasApprovalThisCycle` | 287 | `true` apabila `getLastApprover` non-null |
| `getEditLockRoleLabel` | 342 | Wrapper UI-friendly `getEditLockLevel` — mengembalikan nama role siapa yang menjadi threshold lock saat ini, atau null |

### Matrix role → visibility → edit → approve

| Role | Lihat | Bisa edit | Bisa approve/forward | Bisa bikin POA | Catatan |
|---|---|---|---|---|---|
| MR | POA sendiri, status apa pun | POA sendiri (kena lock) | tidak | apabila tidak punya subordinate + ≥1 outlet assignment | role leaf |
| ASM | sendiri + subtree langsung (non-draft) | sendiri + subtree visible (kena lock) | apabila `currentHolderId`=sendiri | apabila ada outlet covered dengan `coveredByRole`≠MR | dapat memiliki POA sendiri apabila tim vacant |
| SM | sendiri + subtree 2-hop (non-draft) | pola sama, depth 2 | apabila current holder | rule outlet vacant sama | — |
| NSM | sendiri + subtree 3-hop (non-draft) | pola sama, depth 3 | apabila current holder, ATAU fast-track | rule outlet vacant sama | satu-satunya role dengan fast-track approve + cancel-approved |
| GM | semua, read-only | tidak pernah | tidak pernah | tidak pernah | oversight company-wide, tidak ada write |
| VIEWER | semua, read-only | tidak pernah | tidak pernah | tidak pernah | ditambahkan 2026-07-29, dipisahkan dari GM agar tidak tertukar dengan jabatan GM asli |
| SFE | semua (detail per-POA sejak 2026-07-30) | tidak pernah | tidak pernah | tidak pernah (monitoring-only) | awalnya summary-only |
| ADMIN | semua | selalu | selalu | selalu (testing) | override penuh |

### Lock Edit Logic

Komentar (`authz.ts:233-243`): *"Lock Edit Logic (2026-07-27, business decision): once an ASM/SM/NSM approves OR edits a POA that isn't their own, everyone at a STRICTLY LOWER role level is locked out of editing it... Detected by reading PoaAuditLog rather than a stored flag (chosen over a schema migration) — only entries since the most recent DRAFT/REVISI transition count."*

`getEditLockLevel` (private, `authz.ts:245-261`): fetch semua `PoaAuditLog` secara descending, iterate sampai menemukan `toStatus` DRAFT/REVISI (titik reset siklus), di antara log siklus-berjalan mencari `ROLE_LEVEL` tertinggi dari actor BUKAN owner dengan action APPROVE/UPDATE. Level tertinggi tersebut menjadi `lockLevel` (-1 apabila belum ada yang lock). `canEdit` membandingkan `userLevel < lockLevel`.

## 2. Inventori halaman

| Route | File | Fungsi | Role gate |
|---|---|---|---|
| `/login` | `(auth)/login/page.tsx` | Login NIP-only | — (halaman pre-auth) |
| `/dashboard` | `(app)/dashboard/page.tsx` | List POA (scope by role), progress submit MR, banner pending approval, tombol Export Excel team | Semua role (visibility difilter `getVisiblePoaFilter`/`getPendingActionFilter`) |
| `/poa/new` | `(app)/poa/new/page.tsx` | Pilih periode (tahun+kuartal), buat draft POA | Gate di action-level (`canCreatePoa`) — MR, ASM/SM/NSM tim vacant, ADMIN (testing) |
| `/poa/[id]` | `(app)/poa/[id]/page.tsx` | Detail POA: stats, tab drafting/produk kontes/histori PSSP, aksi approve/reject/fast-track, alur ajukan-edit, audit log, Export Excel per-POA | `canView(actor, poa)` — `page.tsx:76-77` |
| `/poa/[id]/edit` | `(app)/poa/[id]/edit/page.tsx` | Tambah line item baru ke POA draft/revisi | `canEdit` — `page.tsx:37` |
| `/poa/[id]/finalize` | `(app)/poa/[id]/finalize/page.tsx` | Halaman review/checklist sebelum submit (validasi masih stub/TODO) | `canEdit` + status DRAFT/REVISI — `page.tsx:32-33` |
| `/poa/[id]/doctor/[itemId]/edit` | `(app)/poa/[id]/doctor/[itemId]/edit/page.tsx` | Edit (atau lihat read-only) 1 grup line item dokter | `canEdit` ATAU `canView` — `page.tsx:36`, editor mendapat form penuh, viewer read-only (field disabled) |
| `/approvals` | `(app)/approvals/page.tsx` | Checklist POA yang menunggu aksi approval user | MR diblok — `page.tsx:19` |
| `/summary` | `(app)/summary/page.tsx` | Analytics company/subtree-wide (detail §3) | MR diblok — `page.tsx:283`, role lain boleh |
| `/monitoring` | `(app)/monitoring/page.tsx` | Target vs Sales Actual (detail §4) | MR diblok, lalu ADMIN-only sementara — `page.tsx:85,88` |
| `/kpi-perpanjangan` | `(app)/kpi-perpanjangan/page.tsx` | Scorecard KPI bulanan 4-pilar (spesifikasi terpisah, `docs/kpi-monitoring/`) | ADMIN-only — `page.tsx:39` |
| `/pm-dashboard` | `(app)/pm-dashboard/page.tsx` | Rollup per-produk (detail §4) | NSM/ADMIN — `page.tsx:58`, **TETAPI hilang dari Sidebar**, hanya bisa diakses via URL langsung |
| `/customers/new` | `(app)/customers/new/page.tsx` | Placeholder "Coming soon" untuk "Daftar Dokter Baru" | Tidak ada gate; tidak ada di Sidebar, dipanggil ad hoc dari tombol Dashboard MR |
| `/admin` | `(app)/admin/page.tsx` | Hub admin master data: user/staff, outlet, dokter+spesialisasi, produk (`AdminTabs`), toggle Maintenance Mode | ADMIN-only — `page.tsx:26` |
| `/admin/target-produk` | `(app)/admin/target-produk/page.tsx` | Alokasi target qty cascading per produk kontes (NSM→Area/SM→ASM→MR) + "Simulasi Algoritma" legacy | NSM+ADMIN di page, ADMIN-only di Sidebar — `page.tsx:12` |
| `/admin/target-value` | `(app)/admin/target-value/page.tsx` | Target sales Rupiah bulanan per GT/RS, import dari Excel | NSM+ADMIN di page, ADMIN-only di Sidebar — `page.tsx:11` |
| `/faq` | `(app)/faq/page.tsx` | Glosarium istilah non-obvious & formula (bukan glosarium lengkap tiap kolom) | Hanya butuh login, semua role — `page.tsx:9` |

### Sidebar nav (`src/components/layout/Sidebar.tsx:16-100`)

| Item | href | Role yang melihat |
|---|---|---|
| Dashboard | `/dashboard` | semua |
| New POA | `/poa/new` | MR, ADMIN |
| Approvals | `/approvals` | ASM, SM, NSM |
| Summary | `/summary` | ASM, SM, NSM, ADMIN, SFE, GM, VIEWER |
| Monitoring | `/monitoring` | ADMIN saja (sementara, masih direview) |
| Monitoring KPI Perpanjangan | `/kpi-perpanjangan` | ADMIN saja |
| FAQ | `/faq` | semua |
| ~~PM Dashboard~~ | `/pm-dashboard` | **di-comment out total** — page-nya tetap hidup, hanya tidak ter-link dari nav |
| Target Produk | `/admin/target-produk` | ADMIN saja di nav (NSM "temporarily hidden") |
| Target Value | `/admin/target-value` | ADMIN saja di nav |
| Admin | `/admin` | ADMIN saja |

## 3. Halaman Summary (`src/app/(app)/summary/page.tsx`)

Akses: role apa pun kecuali MR (`:283`).

**Tab** (`:217-224`):
- **Ringkasan** — kartu grand-total (bukan grouping asli, fold ke query "mr" internal)
- **Per Personil** (`mr`) — breakdown per-MR. Kolom PIC dihilangkan (2026-08-06) — tiap baris SUDAH mewakili satu MR, jadi PIC-nya redundan.
- **Per Outlet** — breakdown per-outlet, ada kolom Realisasi
- **Per Customer** — breakdown per-dokter, ada kolom Realisasi. Kolom Customer dan PIC dihilangkan (2026-08-06) — tiap baris SUDAH mewakili satu customer.
- **Per Spesialisasi** — breakdown per-spesialisasi, ada growth berdasarkan jumlah customer (`:98-104`, item #13 2026-08-03)
- **Per Produk** — tabel flat per-produk

~~**Per Produk Rekomendasi**~~ — **DIHAPUS (2026-08-06, "tab per produk rekomendasi di summary dihapus aja")**: tab dan seluruh computation-nya (query `outletProductKriteriaRows`, kategori-split `produkKontesGroups`/`lowHangingFruitGroups`/`blueOceanGroups`/`redOceanGroups`/`standarisasiGroups`) dihapus dari `summary/page.tsx`. Sebelumnya: data sama seperti "Per Produk" tetapi dipecah menjadi 5 kategori (Produk Kontes, Low Hanging Fruit, Blue Ocean, Red Ocean, Standarisasi). **Beda dari sidebar "Produk Rekomendasi" di halaman POA form** (`KriteriaProdukPanel`, `docs/TODO.md` #16/#17/#52) — itu fitur terpisah, TIDAK terdampak/TIDAK dihapus, cuma kebetulan nama mirip.

Semua tab (kecuali Ringkasan) di-render melalui `TerritoryTable` — kolom estimasi, variasi produk, jumlah customer, pengajuan, status standarisasi, breakdown budget, sales/realisasi.

**"Growth vs Quarter Sebelumnya"** (`:89-104`): Estimasi kuartal INI (rencana POA disubmit) versus Realisasi kuartal SEBELUMNYA (pelunasan PSSP aktual di bulan-bulan itu) — sengaja BUKAN rencana-vs-rencana ("comparing plan-to-plan told you nothing about whether either plan was realistic; plan-vs-actual does"). Berlaku seragam di semua tab grouping.

**Window periode default** (`:306-323`): tanpa filter eksplisit, default **kuartal ini + 1 kuartal sebelumnya**. Diperketat dari yang awalnya unbounded demi performa (relevan dengan `docs/PERFORMANCE.md`). "Semua periode" 1 klik melalui filter modal.

**Isi kartu Ringkasan** (`:1192-1359`): 4 stat tile (Total Estimasi, Estimasi Aktif+Pengajuan, Target, Estimasi % Target) → breakdown "Total Estimasi per Periode" (+ sub-baris Tercacah) & "per Level" → section "Estimasi per Produk" (bar chart horizontal top-8) → bar chart "Estimasi vs Realisasi" (grouped per periode) → breakdown budget (PSSP/Discount/Entertain + Total Budget) → 4 tile bawah (Growth, Customer, Personil Sudah Submit, Pengajuan).

🟢 **Redesain diimplementasikan 2026-08-05, direvisi berkali-kali sejak itu (terakhir 2026-08-06)** — lihat `docs/summary-ringkasan/` untuk spec lengkap dan status detail per section. Kartu grand-total di atas (4 stat tile → breakdown per Periode/Level → Estimasi per Produk → chart Estimasi vs Realisasi → breakdown budget lama PSSP/Discount/Entertain → 4 tile bawah) **TETAP ADA persis seperti dideskripsikan di atas, tidak diubah/dihapus** — redesain menambahkan beberapa Card baru DI BAWAHNYA, urutan final (2026-08-06): Target/Estimasi/Sales/Pelunasan metric group + varian Produk Kontes → Estimasi PSSP per Bulan → Pencapaian Target (horizontal stacked bar) → Breakdown Historis 5 kelompok. ("Kesesuaian POA", kartu terpisah di versi awal, sudah dihapus — isinya digabung ke metric group di atas.) Filter periode tab Ringkasan (khusus tab ini) diganti dari rentang periode jadi satu kuartal ("Q-Berjalan", `RingkasanQuarterFilter`, dua dropdown Kuartal+Tahun). Beberapa sub-metrik (Breakdown User/KPDM dimensi Aktif, sebagian breakdown Biaya dimensi Aktif, Target varian Produk Kontes) genuinely tidak tersedia karena keterbatasan data model `PsspKontrak` — lihat `docs/summary-ringkasan/README.md` §"Status" untuk daftar lengkap.

## 4. Dashboard, Monitoring, PM Dashboard

**Dashboard** (`(app)/dashboard/page.tsx`): header+role badge, tombol aksi (Daftar User Baru untuk MR, Buat POA Baru apabila eligible, Export Excel team kecuali MR/SFE), kartu pending-approval (non-MR), panel **"Progres Submit MR"** (non-MR, per grup subordinate langsung, auto-detect periode "aktif" dari yang paling banyak submission non-draft — bukan sekadar periode terbaru, `:247-303`), tabel POA (kolom MR/Period/Status/Target/Estimasi/Ratio%/%Budget) dengan pagination 25/50/100/Semua.

**Monitoring** (`(app)/monitoring/page.tsx`): Target vs **Sales Actual** (data sinkronisasi nyata dari `DIR10001B`). Target = `PoaForm.target` (tab MR/Area) atau `ProductTargetAllocation × Product.hna` (tab Produk); tidak ada model target per-outlet sehingga tab tersebut selalu "-" (`:26-48`). Tab: Per MR/Area/Outlet/Produk. Saat ini ADMIN-only (sementara, "widen back... once approved").

**PM Dashboard** (`(app)/pm-dashboard/page.tsx`): rollup per-**produk** dari figur **rencana/estimasi** (bukan sales aktual) di line item yang sudah approved — Estimasi Sales, hitungan status standarisasi, jumlah spesialisasi distinct, jumlah PSSP per produk. NSM/ADMIN, tetapi **tidak ter-link dari Sidebar** — efektifnya hanya bisa diakses via URL langsung/bookmark.

Perbedaan inti: **Monitoring** = target vs pencapaian sales nyata (dipakai ADMIN saat ini); **PM Dashboard** = rollup ala product-manager dari isi POA yang direncanakan + progress standarisasi (NSM/ADMIN, tetapi tidak ter-link).

## 5. Excel Export

### `GET /api/poa/[id]/export` — single POA

| Sheet | Isi |
|---|---|
| Summary | Info header POA, total Estimasi/Anggaran, status ratio budget, cakupan (jumlah customer/produk), hitungan status listing |
| Estimasi PSSP per Bulan | Estimasi & Nilai PSSP disebar rata ke tiap bulan rencana, 1 baris per metrik per level personil (formula sama seperti panel "Ringkasan POA" in-app, `computeMonthlyBreakdown`) |
| Pengisian | Sheet utama line item — 1 baris per line item (dikelompokkan+dinomori per dokter), ~55 kolom |
| PSSP Aktif | Semua kontrak PSSP yang sedang berjalan (`PsspKontrak`) + semua snapshot Hospinet untuk outlet MR tersebut, digabungkan dengan kolom "Sumber" |
| Audit Log | Histori approval/perubahan status POA |

### `GET /api/export/team` — bulk untuk ASM/SM/NSM

| Sheet | Isi |
|---|---|
| Ringkasan Tim | Total agregat lintas seluruh tim subordinate MR |
| Per MR | 1 baris per (MR, POA) — MR dengan beberapa kuartal submit mendapat beberapa baris, tidak di-collapse |
| Estimasi PSSP per Bulan | Logic monthly-breakdown yang sama, di-roll-up per level personil |
| Semua Pengajuan | Semua line item lintas semua POA — **struktur kolom SAMA PERSIS dengan sheet "Pengisian"** (diselaraskan 2026-08-05, stakeholder request), plus 2 kolom tambahan di depan (Periode POA, Status Approval) yang tidak ada equivalent-nya di sheet MR karena sheet ini mencakup banyak POA sekaligus |
| PSSP Aktif | Sama seperti single-POA, scope ke outlet seluruh tim, + atribusi MR/ASM/SM/NSM |
| Summary Per Outlet | Rollup per-outlet, mencerminkan tab "Per Outlet" `/summary` |
| Summary by Produk | Rollup per-produk, mencerminkan tab "Per Produk" `/summary` |

Kedua route berbagi fungsi helper yang **sengaja diduplikasi** (bukan modul bersama) — `resolveDiskonPeriodLabel`, `computePelunasanPct`, `computeOldEstPerMonth`, `BENTUK_PSSP_LABELS` — konvensi per-file yang secara eksplisit diakui di komentar kode.

**Entry point UI**: single-POA export hanya dari tombol "↓ Export Excel" di halaman Detail POA; team export hanya dari tombol "↓ Export Excel" di Dashboard (kecuali MR/SFE). Tidak ada UI yang mengirim `?period=` ke team export (selalu default semua periode) walaupun route-nya mendukung.

## 6. Integrasi eksternal

⚠️ **Nexus dan Exodus Activity adalah 2 sistem BERBEDA — jangan tertukar.**

### Nexus API (`api-nexus.pharos.id`)
Dipakai di `src/app/actions/customer.ts:530-608` — fallback pencarian customer LIVE, digabungkan dengan hasil DB lokal saat user mencari customer di 1 outlet (safety net untuk gap import customer). Endpoint publik, **tanpa autentikasi**. Read-only, best-effort (timeout 5 detik, semua error ditelan secara diam-diam — gagal berarti kembali ke hasil lokal saja). Match Nexus-only mendapat id sintetis `nexus:<kode>`; apabila user memilihnya, `LineItemEditor.tsx` memateralisasikannya menjadi baris `Customer` nyata terlebih dahulu via `createCustomerAction` sebelum dapat dipakai di line item.

### Exodus Activity API (`src/lib/exodusApi.ts`)
Histori jumlah kunjungan MR per customer+outlet+periode. Auth: OAuth2 client-credentials ke `EXODUS_AUTH_URL`, token di-cache in-memory. Env var (`EXODUS_AUTH_URL`/`CLIENT_ID`/`CLIENT_SECRET`/`API_BASE_URL`) semua **optional** di schema env, berbeda per environment, di-set via Vault. Degradasi graceful total — apabila tidak dikonfigurasi atau call-nya gagal, mengembalikan `null`, tidak pernah throw ("a down/unconfigured external service should degrade the UI to 'no data', never break the page it's called from"). Read-only.

### MSSQL sync (`mkt_insight`) — kegagalan fail-loud, BUKAN degradasi silent

Berbeda dari Nexus/Exodus di atas — ketiga route sync batch (`POST /api/sync/org-structure`, `/api/sync/sales-history`, `/api/sync/sales-value-monthly`, masing-masing `route.ts:26-39`, pola identik di ketiganya) tidak mendegradasi apa pun secara silent. Kegagalan koneksi/query MSSQL ditangkap, di-log via `console.error`, dan direspons dengan HTTP 500 (`{ error: "Sync failed", detail: String(err) }`) ke pemanggilnya. Karena route ini dipicu oleh cron eksternal — bukan diakses langsung dari browser pengguna — kegagalannya tidak pernah membuat halaman aplikasi crash; dampaknya adalah data (`OutletSalesHistory`/`OutletSalesValueMonthly`/`User`+org) menjadi stale sampai retry cron berikutnya berhasil. Ketiganya juga menolak berjalan apabila `MSSQL_CONNECTION_STRING` tidak di-set (500) dan membutuhkan header `X-Sync-Secret` yang cocok dengan env `SYNC_SECRET` apabila env tersebut di-set (401 jika tidak cocok). Lihat juga catatan sumber data di `02-data-model.md` §3.

## 7. Maintenance mode (`src/lib/maintenance.ts`)

Backed 1 baris singleton `MaintenanceMode` (id=1): `enabled`, `viewOnly`, `message`. Dua level: `enabled` = lockout penuh; `viewOnly` = lebih lunak. Keduanya memblok write melalui `isWriteBlocked()`/`assertWritable()` — ADMIN selalu dikecualikan. Blocking-nya hanya di jalur mutation (server action), BUKAN gate akses halaman/baca — baca tetap berjalan. **Fail-open**: error DB saat membaca row maintenance ditangkap dan dianggap `disabled` (sengaja, agar hiccup DB sesaat tidak menyebabkan lockout situs-wide tanpa cara mematikannya).

## 8. Non-goals (sengaja belum dibangun, per 2026-08-05)

*(Section ini tidak ada di spesifikasi retroaktif yang pertama kali menulis dokumen ini — ditambahkan agar konsisten dengan `02-spec-template.md` §"03-ui-and-access.md", walaupun framing-nya berbeda dari "non-goals v1" yang biasa dipakai spesifikasi pre-code: di sini isinya adalah hal yang SUDAH diputuskan untuk tidak dikerjakan/ditunda untuk sistem yang sudah berjalan, dilihat dari kode+`docs/TODO.md`, bukan proposal yang belum mulai.)*

- **Monitoring & PM Dashboard company-wide** — `/monitoring` sengaja dibatasi ADMIN-only "sementara direview" (§2), `/pm-dashboard` sengaja tidak di-link dari Sidebar walaupun page-nya hidup dan NSM/ADMIN boleh mengakses via URL langsung. Widen akses menunggu keputusan bisnis, bukan kelupaan.
- **Target Produk untuk NSM** — di-hide dari Sidebar sejak 2026-07-24 ("NSM temporarily hidden"), komentar kode secara eksplisit menyatakan tinggal menambah kembali role-nya apabila ingin di-reaktifkan.
- **`OutletStrukturBaru` (draft restrukturisasi org 2026)** — sengaja dibuat sebagai model staging terpisah, review-only, TIDAK terhubung ke `Outlet`/`MrOutletAssignment`/approval — bukan setengah-jadi, memang belum ada keputusan untuk cutover.
- **`JenisPssp` (PSSP/PSSP_RETENSI/PSSP_PEREMAJAAN/PSSP_PERPANJANGAN)** — field & logic-nya dipertahankan di schema tetapi disembunyikan dari UI, belum ada kejelasan kapan/apakah akan di-reenable (lihat `01-business-rules.md` §"Open questions").
- **Halaman "Daftar Dokter Baru" (`/customers/new`)** — masih placeholder "Coming soon", tidak ada di Sidebar.
- **Validasi pre-submit di `/poa/[id]/finalize`** — halaman checklist ini masih stub/TODO (`page.tsx:32-33`, lihat §2), belum ada validasi konkret yang dijalankan sebelum submit selain gate akses `canEdit` + status DRAFT/REVISI.
- **Konsistensi "parent = sum(anak)" pada `ProductTargetAllocation`** — hierarki cascading NSM→SM→ASM→MR hanya divalidasi di level UI, tidak ada constraint database yang menegakkannya (lihat `02-data-model.md` §1 "Target").
- Item lain yang statusnya masih 🟡/⬜ di `docs/TODO.md` (mis. #1 struktur baru masih ada sisa outlet yang belum ter-resolve, #25 histori visit belum dipasang di titik yang diminta) juga relevan untuk area UI/akses ini — dicek langsung di `docs/TODO.md` untuk status terbaru, jangan diasumsikan dari dokumen ini saja karena statusnya berubah cepat.

## 9. Mock DB mode (`USE_MOCK_DB`)

Untuk dev lokal tanpa Postgres/MSSQL nyata. `USE_MOCK_DB=true` → `src/lib/prisma.ts` memakai `mockPrismaClient` (in-memory array, subset API query Prisma, tulisan hanya hidup selama proses berjalan). Data fixture dari `src/lib/mock/data.ts`, atau `generated-data.json` (gitignored) hasil `npm run mock:generate` yang membaca Excel sumber asli.
