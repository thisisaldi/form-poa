# Form POA — UI & Access

*(Retroaktif — didokumentasiin dari `src/lib/authz.ts`, tiap `page.tsx` di `src/app/(app)/`, `src/components/layout/Sidebar.tsx`, kedua route export Excel, dan integrasi eksternal. Semua klaim ada file:line-nya.)*

## 1. Resolusi hierarki organisasi & access (`src/lib/authz.ts`)

Single source of truth buat semua permission check — **jangan bikin RBAC ad-hoc di tempat lain**, generalisasi dari fungsi-fungsi ini.

| Fungsi | Baris | Fungsinya |
|---|---|---|
| `getMrIdsUnder` (private) | 51 | BFS level-by-level, resolve nip MR leaf doang di bawah 1 manager, dibatasi `depth` hop; dibungkus React `cache()` buat dedup panggilan berulang per-baris dalam 1 request |
| `getSubordinateIdsUnder` (private) | 83 | BFS sama tapi balikin SEMUA subordinate (termasuk manager perantara) — perlu karena manager bisa self-own POA (kasus tim vacant) yang tetep harus keliatan ke atasannya sendiri |
| `getSubordinateMRNips` | 104 | Public: semua nip MR di subtree user. MR→diri sendiri; ADMIN/GM/SFE/VIEWER→semua MR aktif non-dummy company-wide; ASM/SM/NSM→BFS via `getMrIdsUnder` depth 1/2/3 |
| `getVisiblePoaFilter` | 134 | Balikin klausa `WHERE` Prisma buat scope query list POA per role: MR cuma punya sendiri; ASM/SM/NSM punya sendiri (status apapun) + subordinate non-draft; GM/VIEWER/SFE/ADMIN semua (`{}`) |
| `canView` | 203 | Cek per-POA: ADMIN/GM/VIEWER/SFE selalu true; owner selalu true; MR cuma punya sendiri; manager butuh subordinate-di-subtree DAN status bukan DRAFT/REVISI |
| `canEdit` | 316 | Jalanin gate Lock Edit Logic dulu, baru: ADMIN selalu; owner selalu; ASM/SM/NSM kalau `canView` lolos. GM dikecualikan total (read-only) |
| `canApprove` | 353 | Lebih ketat dari `canEdit` — ADMIN, atau ASM/SM/NSM cuma kalau mereka current holder (`currentHolderId === user.nip`) |
| `canFastTrackApprove` | 380 | NSM-only: approve langsung ke fully-approved skip ASM/SM, asal POA genuinely pending & di subtree NSM |
| `canCancelApproved` | 393 | NSM-only: batalin approval sendiri, POA harus persis APPROVED_BY_NSM, gate subtree sama |
| `canRequestEdit` | 410 | Cuma owner, cuma kalau lagi kekunci `canEdit`=false DAN udah ada approval di siklus ini (`hasApprovalThisCycle`) |
| `canRespondEditRequest` | 423 | Cuma orang spesifik yang jadi approver terakhir siklus ini (via `getLastApprover`) yang boleh grant/decline — bukan sembarang orang di level itu |
| `canCreatePoa` | 444 | Akun dummy & ADMIN selalu boleh. MR boleh kalau gak punya subordinate + ≥1 outlet assignment. ASM/SM/NSM boleh kalau ≥1 outlet `coveredByNip`=mereka dengan `coveredByRole`≠MR (exception tim vacant) |
| `getPendingActionFilter` | 476 | MR→POA sendiri yang DRAFT/REVISI; manager→POA yang `currentHolderId`=mereka (inbox mereka) |
| `getLastApprover` | 273 | Scan `PoaAuditLog` desc, berhenti di transisi DRAFT/REVISI terakhir, balikin actorId+role dari log APPROVE terakhir siklus ini (atau null) |
| `hasApprovalThisCycle` | 287 | `true` kalau `getLastApprover` non-null |
| `getEditLockRoleLabel` | 342 | Wrapper UI-friendly `getEditLockLevel` — balikin nama role siapa yang jadi threshold lock sekarang, atau null |

### Matrix role → visibility → edit → approve

| Role | Lihat | Bisa edit | Bisa approve/forward | Bisa bikin POA | Catatan |
|---|---|---|---|---|---|
| MR | POA sendiri, status apapun | POA sendiri (kena lock) | tidak | kalau gak punya subordinate + ≥1 outlet assignment | role leaf |
| ASM | sendiri + subtree langsung (non-draft) | sendiri + subtree visible (kena lock) | kalau `currentHolderId`=sendiri | kalau ada outlet covered dgn `coveredByRole`≠MR | bisa punya POA sendiri kalau tim vacant |
| SM | sendiri + subtree 2-hop (non-draft) | pola sama, depth 2 | kalau current holder | rule outlet vacant sama | — |
| NSM | sendiri + subtree 3-hop (non-draft) | pola sama, depth 3 | kalau current holder, ATAU fast-track | rule outlet vacant sama | satu-satunya role dengan fast-track approve + cancel-approved |
| GM | semua, read-only | tidak pernah | tidak pernah | tidak pernah | oversight company-wide, gak ada write |
| VIEWER | semua, read-only | tidak pernah | tidak pernah | tidak pernah | ditambah 2026-07-29, dipisah dari GM biar gak ketuker sama jabatan GM asli |
| SFE | semua (detail per-POA sejak 2026-07-30) | tidak pernah | tidak pernah | tidak pernah (monitoring-only) | awalnya summary-only |
| ADMIN | semua | selalu | selalu | selalu (testing) | override penuh |

### Lock Edit Logic

Komentar (`authz.ts:233-243`): *"Lock Edit Logic (2026-07-27, business decision): once an ASM/SM/NSM approves OR edits a POA that isn't their own, everyone at a STRICTLY LOWER role level is locked out of editing it... Detected by reading PoaAuditLog rather than a stored flag (chosen over a schema migration) — only entries since the most recent DRAFT/REVISI transition count."*

`getEditLockLevel` (private, `authz.ts:245-261`): fetch semua `PoaAuditLog` desc, iterate sampai ketemu `toStatus` DRAFT/REVISI (titik reset siklus), di antara log siklus-berjalan cari `ROLE_LEVEL` tertinggi dari actor BUKAN owner dengan action APPROVE/UPDATE. Level tertinggi itu jadi `lockLevel` (-1 kalau belum ada yang lock). `canEdit` bandingin `userLevel < lockLevel`.

## 2. Inventori halaman

| Route | File | Fungsi | Role gate |
|---|---|---|---|
| `/login` | `(auth)/login/page.tsx` | Login NIP-only | — (halaman pre-auth) |
| `/dashboard` | `(app)/dashboard/page.tsx` | List POA (scope by role), progress submit MR, banner pending approval, tombol Export Excel team | Semua role (visibility difilter `getVisiblePoaFilter`/`getPendingActionFilter`) |
| `/poa/new` | `(app)/poa/new/page.tsx` | Pilih periode (tahun+kuartal), bikin draft POA | Gate di action-level (`canCreatePoa`) — MR, ASM/SM/NSM tim vacant, ADMIN (testing) |
| `/poa/[id]` | `(app)/poa/[id]/page.tsx` | Detail POA: stats, tab drafting/produk fokus/histori PSSP, aksi approve/reject/fast-track, alur ajukan-edit, audit log, Export Excel per-POA | `canView(actor, poa)` — `page.tsx:76-77` |
| `/poa/[id]/edit` | `(app)/poa/[id]/edit/page.tsx` | Tambah line item baru ke POA draft/revisi | `canEdit` — `page.tsx:37` |
| `/poa/[id]/finalize` | `(app)/poa/[id]/finalize/page.tsx` | Halaman review/checklist sebelum submit (validasi masih stub/TODO) | `canEdit` + status DRAFT/REVISI — `page.tsx:32-33` |
| `/poa/[id]/doctor/[itemId]/edit` | `(app)/poa/[id]/doctor/[itemId]/edit/page.tsx` | Edit (atau lihat read-only) 1 grup line item dokter | `canEdit` ATAU `canView` — `page.tsx:36`, editor dapet form penuh, viewer read-only (field disabled) |
| `/approvals` | `(app)/approvals/page.tsx` | Checklist POA yang nunggu aksi approval user | MR diblok — `page.tsx:19` |
| `/summary` | `(app)/summary/page.tsx` | Analytics company/subtree-wide (detail §3) | MR diblok — `page.tsx:283`, role lain boleh |
| `/monitoring` | `(app)/monitoring/page.tsx` | Target vs Sales Actual (detail §4) | MR diblok, lalu ADMIN-only sementara — `page.tsx:85,88` |
| `/kpi-perpanjangan` | `(app)/kpi-perpanjangan/page.tsx` | Scorecard KPI bulanan 4-pilar (spec terpisah, `docs/kpi-monitoring/`) | ADMIN-only — `page.tsx:39` |
| `/pm-dashboard` | `(app)/pm-dashboard/page.tsx` | Rollup per-produk (detail §4) | NSM/ADMIN — `page.tsx:58`, **TAPI hilang dari Sidebar**, cuma bisa diakses via URL langsung |
| `/customers/new` | `(app)/customers/new/page.tsx` | Placeholder "Coming soon" buat "Daftar Dokter Baru" | Gak ada gate; gak ada di Sidebar, dipanggil ad hoc dari tombol Dashboard MR |
| `/admin` | `(app)/admin/page.tsx` | Hub admin master data: user/staff, outlet, dokter+spesialisasi, produk (`AdminTabs`), toggle Maintenance Mode | ADMIN-only — `page.tsx:26` |
| `/admin/target-produk` | `(app)/admin/target-produk/page.tsx` | Alokasi target qty cascading per produk fokus (NSM→Area/SM→ASM→MR) + "Simulasi Algoritma" legacy | NSM+ADMIN di page, ADMIN-only di Sidebar — `page.tsx:12` |
| `/admin/target-value` | `(app)/admin/target-value/page.tsx` | Target sales Rupiah bulanan per GT/RS, import dari Excel | NSM+ADMIN di page, ADMIN-only di Sidebar — `page.tsx:11` |
| `/faq` | `(app)/faq/page.tsx` | Glosarium istilah non-obvious & formula (bukan glosarium lengkap tiap kolom) | Cuma butuh login, semua role — `page.tsx:9` |

### Sidebar nav (`src/components/layout/Sidebar.tsx:16-100`)

| Item | href | Role yang lihat |
|---|---|---|
| Dashboard | `/dashboard` | semua |
| New POA | `/poa/new` | MR, ADMIN |
| Approvals | `/approvals` | ASM, SM, NSM |
| Summary | `/summary` | ASM, SM, NSM, ADMIN, SFE, GM, VIEWER |
| Monitoring | `/monitoring` | ADMIN doang (sementara, masih direview) |
| Monitoring KPI Perpanjangan | `/kpi-perpanjangan` | ADMIN doang |
| FAQ | `/faq` | semua |
| ~~PM Dashboard~~ | `/pm-dashboard` | **di-comment out total** — page-nya tetep hidup, cuma gak ke-link dari nav |
| Target Produk | `/admin/target-produk` | ADMIN doang di nav (NSM "temporarily hidden") |
| Target Value | `/admin/target-value` | ADMIN doang di nav |
| Admin | `/admin` | ADMIN doang |

## 3. Halaman Summary (`src/app/(app)/summary/page.tsx`)

Akses: role apapun kecuali MR (`:283`).

**Tab** (`:246-254`):
- **Ringkasan** — kartu grand-total (bukan grouping asli, fold ke query "mr" internal)
- **Per Personil** (`mr`) — breakdown per-MR
- **Per Outlet** — breakdown per-outlet, ada kolom Realisasi
- **Per Customer** — breakdown per-dokter, ada kolom Realisasi
- **Per Spesialisasi** — breakdown per-spesialisasi, ada growth berdasarkan jumlah customer (`:98-104`, item #13 2026-08-03)
- **Per Produk Rekomendasi** — data sama kayak "Per Produk" tapi dipecah 5 kategori: Produk Fokus, Low Hanging Fruit, Blue Ocean, Red Ocean, Standarisasi
- **Per Produk** — tabel flat per-produk

Semua tab (kecuali Ringkasan/produk-rekomendasi) render lewat `TerritoryTable` — kolom estimasi, variasi produk, jumlah customer, pengajuan, status standarisasi, breakdown budget, sales/realisasi.

**"Growth vs Quarter Sebelumnya"** (`:89-104`): Estimasi kuartal INI (rencana POA disubmit) vs Realisasi kuartal SEBELUMNYA (pelunasan PSSP aktual di bulan-bulan itu) — sengaja BUKAN rencana-vs-rencana ("comparing plan-to-plan told you nothing about whether either plan was realistic; plan-vs-actual does"). Berlaku seragam di semua tab grouping.

**Window periode default** (`:306-323`): tanpa filter eksplisit, default **kuartal ini + 1 kuartal sebelumnya**. Diperketat dari awalnya unbounded demi performa (relevan sama `docs/PERFORMANCE.md`). "Semua periode" 1 klik lewat filter modal.

**Isi kartu Ringkasan** (`:1192-1359`): 4 stat tile (Total Estimasi, Estimasi Aktif+Pengajuan, Target, Estimasi % Target) → breakdown "Total Estimasi per Periode" (+ sub-baris Tercacah) & "per Level" → section "Estimasi per Produk" (bar chart horizontal top-8) → bar chart "Estimasi vs Realisasi" (grouped per periode) → breakdown budget (PSSP/Discount/Entertain + Total Budget) → 4 tile bawah (Growth, Customer, Personil Sudah Submit, Pengajuan).

## 4. Dashboard, Monitoring, PM Dashboard

**Dashboard** (`(app)/dashboard/page.tsx`): header+role badge, tombol aksi (Daftar User Baru buat MR, Buat POA Baru kalau eligible, Export Excel team kecuali MR/SFE), kartu pending-approval (non-MR), panel **"Progres Submit MR"** (non-MR, per grup subordinate langsung, auto-detect periode "aktif" dari yang paling banyak submission non-draft — bukan cuma periode terbaru, `:247-303`), tabel POA (kolom MR/Period/Status/Target/Estimasi/Ratio%/%Budget) dengan pagination 25/50/100/Semua.

**Monitoring** (`(app)/monitoring/page.tsx`): Target vs **Sales Actual** (data sync nyata dari `DIR10001B`). Target = `PoaForm.target` (tab MR/Area) atau `ProductTargetAllocation × Product.hna` (tab Produk); gak ada model target per-outlet jadi tab itu selalu "-" (`:26-48`). Tab: Per MR/Area/Outlet/Produk. Sekarang ADMIN-only (sementara, "widen back... once approved").

**PM Dashboard** (`(app)/pm-dashboard/page.tsx`): rollup per-**produk** dari figur **rencana/estimasi** (bukan sales aktual) di line item yang udah approved — Estimasi Sales, hitungan status standarisasi, jumlah spesialisasi distinct, jumlah PSSP per produk. NSM/ADMIN, tapi **gak ke-link dari Sidebar** — efektifnya cuma bisa diakses via URL langsung/bookmark.

Beda intinya: **Monitoring** = target vs pencapaian sales nyata (dipakai ADMIN sekarang); **PM Dashboard** = rollup ala product-manager dari isi POA yang direncanain + progress standarisasi (NSM/ADMIN, tapi gak ke-link).

## 5. Excel Export

### `GET /api/poa/[id]/export` — single POA

| Sheet | Isi |
|---|---|
| Summary | Info header POA, total Estimasi/Anggaran, status ratio budget, cakupan (jumlah customer/produk), hitungan status listing |
| Estimasi PSSP per Bulan | Estimasi & Nilai PSSP disebar rata ke tiap bulan rencana, 1 baris per metrik per level personil (formula sama kayak panel "Ringkasan POA" in-app, `computeMonthlyBreakdown`) |
| Pengisian | Sheet utama line item — 1 baris per line item (dikelompokkan+dinomorin per dokter), ~55 kolom |
| PSSP Aktif | Semua kontrak PSSP yang lagi jalan (`PsspKontrak`) + semua snapshot Hospinet buat outlet MR itu, digabung dgn kolom "Sumber" |
| Audit Log | Histori approval/perubahan status POA |

### `GET /api/export/team` — bulk buat ASM/SM/NSM

| Sheet | Isi |
|---|---|
| Ringkasan Tim | Total agregat lintas seluruh tim subordinate MR |
| Per MR | 1 baris per (MR, POA) — MR dgn beberapa kuartal submit dapet beberapa baris, gak di-collapse |
| Estimasi PSSP per Bulan | Sama logic monthly-breakdown, di-roll-up per level personil |
| Semua Pengajuan | Semua line item lintas semua POA — **struktur kolom SAMA PERSIS sama sheet "Pengisian"** (diselaraskan 2026-08-05, stakeholder request), plus 2 kolom tambahan di depan (Periode POA, Status Approval) yang gak ada equivalent-nya di sheet MR karena sheet ini nyakup banyak POA sekaligus |
| PSSP Aktif | Sama kayak single-POA, scope ke outlet seluruh tim, + atribusi MR/ASM/SM/NSM |
| Summary Per Outlet | Rollup per-outlet, cermin tab "Per Outlet" `/summary` |
| Summary by Produk | Rollup per-produk, cermin tab "Per Produk" `/summary` |

Kedua route berbagi fungsi helper yang **sengaja diduplikasi** (bukan modul bersama) — `resolveDiskonPeriodLabel`, `computePelunasanPct`, `computeOldEstPerMonth`, `BENTUK_PSSP_LABELS` — konvensi per-file yang eksplisit diakui di komentar kode.

**Entry point UI**: single-POA export cuma dari tombol "↓ Export Excel" di halaman Detail POA; team export cuma dari tombol "↓ Export Excel" di Dashboard (kecuali MR/SFE). Gak ada UI yang pass `?period=` ke team export (selalu default semua periode) walau route-nya support.

## 6. Integrasi eksternal

⚠️ **Nexus dan Exodus Activity itu 2 sistem BEDA — jangan ketuker.**

### Nexus API (`api-nexus.pharos.id`)
Dipake di `src/app/actions/customer.ts:530-608` — fallback pencarian customer LIVE, digabung sama hasil DB lokal pas user cari customer di 1 outlet (safety net buat gap import customer). Endpoint publik, **tanpa autentikasi**. Read-only, best-effort (timeout 5 detik, semua error ditelan diam-diam — gagal ya balik ke hasil lokal doang). Match Nexus-only dapet id sintetis `nexus:<kode>`; kalau user pilih itu, `LineItemEditor.tsx` materialize jadi `Customer` row nyata dulu via `createCustomerAction` sebelum bisa dipake di line item.

### Exodus Activity API (`src/lib/exodusApi.ts`)
Histori jumlah kunjungan MR per customer+outlet+periode. Auth: OAuth2 client-credentials ke `EXODUS_AUTH_URL`, token di-cache in-memory. Env var (`EXODUS_AUTH_URL`/`CLIENT_ID`/`CLIENT_SECRET`/`API_BASE_URL`) semua **optional** di schema env, beda per environment, di-set via Vault. Degradasi graceful total — kalau gak dikonfigurasi atau call-nya gagal, balikin `null`, gak pernah throw ("a down/unconfigured external service should degrade the UI to 'no data', never break the page it's called from"). Read-only.

## 7. Maintenance mode (`src/lib/maintenance.ts`)

Backed 1 baris singleton `MaintenanceMode` (id=1): `enabled`, `viewOnly`, `message`. Dua level: `enabled` = lockout penuh; `viewOnly` = lebih lunak. Dua-duanya block write via `isWriteBlocked()`/`assertWritable()` — ADMIN selalu dikecualikan. Blocking-nya cuma di jalur mutation (server action), BUKAN gate akses halaman/baca — baca tetep jalan. **Fail-open**: error DB pas baca row maintenance ditangkep dan dianggap `disabled` (sengaja, biar hiccup DB sesaat gak bikin lockout situs-wide tanpa cara matiinnya).

## 8. Mock DB mode (`USE_MOCK_DB`)

Buat dev lokal tanpa Postgres/MSSQL nyata. `USE_MOCK_DB=true` → `src/lib/prisma.ts` pake `mockPrismaClient` (in-memory array, subset API query Prisma, tulisan cuma hidup selama proses jalan). Data fixture dari `src/lib/mock/data.ts`, atau `generated-data.json` (gitignored) hasil `npm run mock:generate` yang baca Excel sumber asli.
