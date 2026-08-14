# POA Approval Per Dokter — UI & Access (usulan, belum diimplementasikan)

## Role/access matrix

Tidak ada role baru — reuse penuh `src/lib/authz.ts` yang sudah ada, generalisasi predikat existing dari "beroperasi atas `PoaForm`" menjadi "beroperasi atas `PoaDoctorApproval`":

| Role | Bisa lihat | Bisa approve/reject | Catatan |
|---|---|---|---|
| MR (owner) | Draft miliknya sendiri, semua dokter | — (bukan approver) | `canEdit` — tetap gate per-dokter kalau OQ-3 (Lock Edit Logic per-dokter) dikonfirmasi |
| ASM/SM/NSM | Draft di subtree-nya (`canView`, tidak berubah) | Dokter di draft itu yang `currentHolderId` = dirinya | `canApprove` di-generalisasi: cek `PoaDoctorApproval.currentHolderId`, bukan `PoaForm.currentHolderId` |
| NSM | — | Fast-track & cancel-approved per dokter (OQ-4) | `canFastTrackApprove`/`canCancelApproved` perlu parameter dokter, bukan cuma `poa` |
| ADMIN | Semua | Semua (existing override, tidak berubah) | Tidak berubah |
| GM | Read-only semua (existing, tidak berubah) | — | Tidak berubah |

Constraint eksplisit: JANGAN bikin RBAC baru — semua predikat di atas adalah generalisasi `canView`/`canEdit`/`canApprove` yang sudah ada, dengan parameter tambahan `doctorKey` di mana relevan.

## Halaman yang terdampak

- **`src/app/(app)/poa/[id]/page.tsx`** (halaman detail POA + form approve/reject) — perubahan UI paling besar. Tombol "Approve"/"Tolak"/"Batalkan Approval" saat ini 1 set untuk seluruh draft; perlu jadi per-dokter, kemungkinan checklist/list dokter dengan tombol approve/reject di tiap baris (mis. reuse pola `DraftChecklist.tsx`'s `DoctorRow` yang sudah mengelompokkan baris per dokter, tinggal ditambah kontrol approval).
- **Approval inbox / list POA yang perlu direview** (halaman mana pun yang saat ini query `PoaForm.currentHolderId = session.user`) — query berubah jadi lewat `PoaDoctorApproval.currentHolderId`, kemungkinan 1 draft bisa muncul beberapa kali di inbox kalau approver punya >1 dokter pending di draft yang sama, ATAU digroup jadi 1 entry draft dengan badge "2 dokter menunggu review". **BLOCKING** — bentuk tampilan mana yang dipakai perlu keputusan produk (lihat OQ-1 di `01-business-rules.md`).
- **Riwayat Aktivitas** (`page.tsx:495-499` di form-poa) — perlu menampilkan nama dokter yang terkait tiap entry approve/reject (dari `PoaAuditLog.doctorApprovalId` → `PoaDoctorApproval.namaCust`), supaya jelas approve/reject itu untuk dokter yang mana.
- **Export Excel** (`src/app/api/poa/[id]/export/route.ts`, `src/app/api/export/team/route.ts`) dan **dashboard Summary/Monitoring** — lihat OQ-6, belum didesain karena tergantung jawaban rollup di §3a.

## Pola UI yang direuse

- `DraftChecklist.tsx`'s pengelompokan per-dokter (`DoctorRow`, `doctorKey`) — sudah ada mekanisme mengelompokkan `PoaLineItem[]` jadi per-dokter di UI, ini yang jadi basis unit approval baru, bukan komponen baru dari nol.
- Badge status yang sudah ada untuk `PoaStatus` (warna per status) — direuse per-baris-dokter alih-alih 1 badge besar di header draft.
- Form textarea alasan reject yang sudah wajib (`page.tsx:411-425`) — tetap dipakai, cuma target-nya sekarang 1 dokter spesifik, bukan seluruh draft. Kalau `docs/poa-rejection-categories/` (kategori reject) sudah/akan diimplementasikan, kategori itu juga perlu ikut jadi per-dokter — cross-reference dua arah perlu ditulis begitu urutan implementasi kedua fitur ini diputuskan.

## Non-goals (usulan v1)

- **Approval per-produk** (lebih granular dari per-dokter) — eksplisit di luar scope, lihat OQ-7 di `01-business-rules.md`.
- **Bulk approve/reject lintas-dokter** (mis. checkbox banyak dokter sekaligus lalu 1 klik approve semua) — tidak diminta di task asli, approver tetap klik satu-satu per dokter di v1 ini kecuali diminta terpisah.
- **Perubahan pada halaman survey/data-survey, KPI Monitoring, atau spec lain yang tidak disebutkan** — scope fitur ini murni state machine approval POA.

## Cross-reference

- `docs/form-poa/01-business-rules.md` §1 — state machine `PoaStatus` level-draft yang ADA saat ini (dasar sebelum perubahan ini).
- `docs/form-poa/03-ui-and-access.md` — role/access matrix existing (`authz.ts`) yang digeneralisasi di sini.
- `docs/poa-rejection-categories/` — spec terpisah untuk kategori alasan reject; kalau kedua fitur ini jalan bersamaan, kategori reject perlu ikut disesuaikan ke unit per-dokter (lihat catatan di atas).
- `docs/PERFORMANCE.md` — constraint wajib untuk query `PoaDoctorApproval` yang company-wide (approval inbox, dashboard).
