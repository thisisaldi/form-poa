# POA System

Internal web application for pharmaceutical sales reps and their managers to plan,
submit, and approve quarterly "POA" (Plan of Action) — per-doctor, per-product
promotion/budget plans tied to PSSP (contract) history and discount data.

## Organizational Hierarchy

```
MR (Medical Representative)
  └── ASM (Area Sales Manager)
        └── SM (Sales Manager)
              └── NSM (National Sales Manager)
```

Plus three roles outside that chain:

| Role | Access |
|---|---|
| `ADMIN` | Full access everywhere, plus the Admin panel (user/master-data CRUD). Can create test POAs regardless of outlet assignment. |
| `GM` | Read-only, company-wide oversight. No approve/create/edit rights anywhere. |
| `SFE` | Summary-page-only monitoring. No per-POA visibility. |

Hierarchy is always resolved dynamically against the current `User.nipAtasan` —
org changes propagate automatically, nothing is cached/denormalized. `ADMIN`
and `GM` don't sit in this chain at all, so anything scoped to "my subordinate
MRs" (Summary, dashboards) goes through the shared `getSubordinateMRNips()`
helper, which special-cases those two roles to mean "everyone company-wide"
instead of walking `nipAtasan` (which would return nothing for them).

## POA Workflow

```
DRAFT → SUBMITTED_TO_ASM → APPROVED_BY_ASM → SUBMITTED_TO_SM
      → APPROVED_BY_SM → SUBMITTED_TO_NSM → APPROVED_BY_NSM
```

Any `SUBMITTED_TO_*` state can bounce back to `REVISI` — either automatically
(the owning MR edits an already-submitted POA) or explicitly (the current
holder rejects it with a reason). `REVISI` resubmits back through
`SUBMITTED_TO_ASM`, restarting the approval chain from the top and bumping
`PoaForm.version`.

- MR creates a draft and fills in line items (product × doctor combinations)
- MR submits → ASM receives and can review/approve
- ASM approves → SM → NSM
- Once submitted, the previous level can only view read-only
- An NSM can fast-track approve a POA straight to `APPROVED_BY_NSM`, skipping
  ASM/SM review entirely (`fastTrackApprove` in `poaWorkflow.ts`)
- An NSM can also cancel their own completed approval, bouncing it back to
  `REVISI` (`cancelApprovedByNsm`)
- SM/NSM can bulk-approve everything in their Approvals inbox at once
- DRAFT POAs cannot be exported to Excel

### Edit lock + "Ajukan Edit" request flow

Once any ASM/SM/NSM has approved a POA this cycle, the owning MR is locked
out of editing (`getEditLockLevel` scans `PoaAuditLog` back to the last
`DRAFT`/`REVISI` transition). Rather than just waiting for a spontaneous
reject/cancel, the locked-out owner can send an explicit **"Ajukan Edit"**
request to whoever the last approver was:

- `requestEdit` (owner-only) logs a `REQUEST_EDIT` audit entry and emails the
  last approver.
- `grantEditRequest` (that specific approver only) is functionally the same
  as cancelling their own approval — bounces the POA to `REVISI`.
- `declineEditRequest` just logs the decline with a reason; status/holder
  are untouched.

---

## Setup

### 1. Prerequisites

- Node.js 18+
- PostgreSQL (running locally or remote)
- MSSQL (for org/product/customer/sales sync — VPN required; a mock-DB mode
  exists for offline development, see below)

### 2. Environment Variables

```bash
cp .env.example .env
# Edit .env and fill in real values
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `MSSQL_CONNECTION_STRING` | Yes (unless `USE_MOCK_DB=true`) | MSSQL source DB — org/product/customer/sales sync |
| `SESSION_SECRET` | Yes | Min 32 chars — used to encrypt sessions (`openssl rand -base64 32`) |
| `EMAIL_FROM` | No | Sender address (mock email by default — see Notifications below) |
| `RESEND_API_KEY` | No | Resend API key (once email provider is wired) |
| `SYNC_SECRET` | No | Shared secret for `POST /api/sync/org-structure` (`openssl rand -hex 16`) |
| `NEXT_PUBLIC_BASE_URL` | No | Used in email links |
| `USE_MOCK_DB` | No | `"true"` runs off `src/lib/mock/generated-data.json` instead of a live MSSQL sync — no VPN needed |

### 3. Database Setup

```bash
npm install                  # also runs `prisma generate` via postinstall
npx prisma migrate dev       # apply schema migrations (local dev)
# or: npm run db:migrate     # `prisma migrate deploy` (staging/production)
```

### 4. Populate Data

Real sync (needs MSSQL/VPN):

```bash
npm run sync:org         # org hierarchy → User table
npm run sync:products    # Product master
npm run sync:customers   # Customer/CustomerOutlet master
```

Other master-data imports (PSSP history, DPL/discount, survey, listing fee,
etc.) are one-off scripts run manually from Excel sources — see
[Scripts](#scripts) below. Most are idempotent upserts, safe to re-run.

Offline/mock mode (no VPN needed):

```bash
npm run mock:generate    # regenerate src/lib/mock/generated-data.json from source Excel/CSV
npm run seed:local       # seed a local Postgres DB from that JSON
```

Dummy test accounts (national all-outlet access, walk the full approval
chain solo): use the Admin panel's **"Buat Akun Dummy"** form, or run
`npx tsx scripts/generateDummyAccounts.ts` to bulk-generate one
`MR/ASM/SM/NSM` chain per real employee's NIP.

### 5. Run Development Server

```bash
npm run dev
# Open http://localhost:3000
# Login with the NIP of any seeded user — no password (see Auth below)
```

---

## Project Structure

```
src/
├── app/
│   ├── (auth)/login/              # NIP login page
│   ├── (app)/                     # Authenticated shell (sidebar layout)
│   │   ├── dashboard/             # Role-aware POA list + MR submit-progress stats
│   │   ├── pm-dashboard/          # PM-facing product/summary dashboard
│   │   ├── summary/               # Aggregate stats: Per Outlet/Customer/Produk/Personil tabs
│   │   ├── monitoring/            # Legacy alias, redirects to /summary
│   │   ├── approvals/             # Manager inbox — includes bulk-approve for SM/NSM
│   │   ├── admin/                 # Admin panel (ADMIN role only) + target-produk allocation
│   │   ├── customers/new/         # "Daftar User Baru" multi-step doctor registration
│   │   ├── faq/
│   │   └── poa/
│   │       ├── new/               # Create draft (MR only)
│   │       └── [id]/
│   │           ├── page.tsx       # Detail / view / approve / Ajukan Edit
│   │           ├── edit/          # Edit draft — hosts LineItemEditor
│   │           ├── doctor/[itemId]/edit/  # Edit one doctor's line items directly
│   │           └── finalize/      # Final review before submit
│   ├── api/
│   │   ├── auth/{login,logout}/
│   │   ├── export/team/           # GET — bulk Excel for NSM/SM/ASM (6 sheets)
│   │   ├── poa/[id]/export/       # GET — single POA Excel (Summary/Pengisian/PSSP Aktif/Audit Log)
│   │   ├── outlets/, users/[nip]/{outlets,subordinates,superiors}/
│   │   └── sync/{org-structure,sales-history,sales-value-monthly}/  # POST — trigger MSSQL sync
│   └── actions/                   # Server Actions (mutations) — poa.ts, lineItem.ts, admin.ts, customer.ts, customerPengajuan.ts, auth.ts
├── lib/
│   ├── env.ts                     # Zod-validated env vars
│   ├── prisma.ts                  # Singleton Prisma client
│   ├── session.ts                 # iron-session setup
│   ├── auth.ts                    # Identity verification (NIP lookup) — the ONLY login gate
│   ├── authz.ts                   # Permission checks — canView/canEdit/canApprove/getSubordinateMRNips/getEditLockLevel/canRequestEdit/…
│   ├── poaWorkflow.ts             # State machine — every PoaForm.status mutation goes through here
│   ├── poaUtils.ts                # Period helpers (formatPeriode, computePeriodeAkhir)
│   ├── masterData.ts              # Product & outlet master data, getOutletsByUser
│   ├── paketProduk.ts             # Fokus-product "paket" lookup by spesialisasi
│   ├── spesialisasi.ts            # Doctor specialization label mapping
│   ├── targetCalculation.ts       # Sales target math (OutletSalesMonthly-driven)
│   ├── notifications.ts           # Email abstraction (mock → swap provider)
│   ├── role.ts                    # Role display-label helper (respects `jabatan` override)
│   └── mock/                      # USE_MOCK_DB data + client
├── components/
│   ├── layout/Sidebar.tsx
│   ├── poa/
│   │   ├── LineItemEditor.tsx         # Line item add/edit form — by far the largest file, see below
│   │   ├── DraftChecklist.tsx         # MR's own draft checklist + "Ringkasan POA" stats
│   │   ├── ApprovalsChecklist.tsx     # Manager inbox list + bulk-approve
│   │   ├── MonitoringChecklist.tsx    # Summary-page stat cards
│   │   └── TerritoryTable.tsx         # Summary-page per-row breakdown table
│   ├── admin/AdminTabs.tsx, TargetProdukForm.tsx, TargetAllocationDrilldown.tsx
│   └── ui/                        # Button, Card, Combobox, StatusBadge, ConfirmDialog, Input
scripts/                           # One-off + repeatable sync/import/seed scripts — see Scripts below
prisma/
├── schema.prisma
└── migrations/
```

### Inside `LineItemEditor.tsx`

This is the core of the app — one file, several thousand lines, covering
every way a line item gets created or edited:

- **`AddPanel`** — add a new doctor: pick outlet → doctor → one or more
  products in a single submission. Owns the draft-autosave-to-`localStorage`
  feature (`` `poa-draft-add-${poaId}` ``, restored on mount, debounced
  ~400ms re-save, cleared on success or cancel).
- **`AddProductPanel`** — add more products to a doctor *already* on the POA;
  inherits that doctor's shared `pengaliNilaiR`/`pihakPssp`/`bentukPssp`
  rather than letting them diverge per product.
- **`AddDokterBaruPanel`** — register a brand-new doctor (not yet synced from
  the CDB) inline, feeding into manual-customer creation.
- **`EditDoctorPanel`** — edit every product for one doctor at once.
- **`ProdukEntryRow`** — the per-product widget: product picker (grouped
  Pernah PSSP → Produk Fokus → Produk Survey → Lainnya), resep/qty inputs,
  the auto-filled "grey calculator" fields (discount %, kriteria, PSSP-ever
  flag).
- **Sidebar panels**, switched via three color-coded pill tabs — **Data
  Survey** (orange, raw `SurveyRekomendasi` rows), **Produk Rekomendasi**
  (green, `KriteriaProdukPanel` — criteria tags + duplicated Produk Survey
  section), **Histori PSSP** (blue, `PsspHistoryPanel` — this doctor's PSSP
  contract history, Hospinet-snapshot fallback when empty).

"PSSP ke-N" (shown in the sidebar badge, the doctor-picker dropdown, and the
customer info card) = the count of *distinct* `cUrut` contract numbers in a
doctor's history — same convention everywhere it's shown.

---

## Data Model

`prisma/schema.prisma` — two rough categories:

**Operational** (created/mutated by the app itself): `User`, `PoaForm`,
`PoaLineItem`, `PoaAuditLog`, `CustomerPengajuan`, `ProductTargetAllocation`
(current top-down NSM→SM→ASM→MR target cascade; `ProductTargetInput` is its
superseded predecessor), `OutletProductKriteria`, `OrgStrukturMeta`.

**Master data** (synced from MSSQL or imported from Excel — never edited by
end users, only re-synced): `Customer`/`CustomerOutlet`, `Outlet`, `Product`,
`MrOutletAssignment`, `PsspKontrak` (PSSP contract history),
`PsspHospinetSnapshot` (coarser Hospinet-division fallback),
`SurveyRekomendasi`, `ListingFeeKontrak`, `OutletStrukturBaru` (draft 2026
org-restructure staging table, not yet wired into live assignments),
`DiskonKontrak`/`DiskonHistory` (see below), `OutletSalesHistory` /
`OutletSalesMonthly` / `OutletSalesValueMonthly` (three different sales-data
grains feeding different features).

### Key enums

| Enum | Values | Notes |
|---|---|---|
| `Role` | `MR ASM SM NSM GM ADMIN SFE` | |
| `PoaStatus` | `DRAFT SUBMITTED_TO_ASM APPROVED_BY_ASM SUBMITTED_TO_SM APPROVED_BY_SM SUBMITTED_TO_NSM APPROVED_BY_NSM REVISI` | |
| `PsSp` | `PS SP` | Doctor-level, shown as the required "PS / SP" dropdown |
| `BentukPssp` | `CASH BARANG JASA` | Doctor-level "Jenis PSSP" dropdown, next to PS/SP — distinct from `JenisPssp` below |
| `JenisPssp` | `PSSP PSSP_RETENSI PSSP_PEREMAJAAN PSSP_PERPANJANGAN` | Per-product field — currently hidden in the UI, logic kept intact |
| `PihakPssp` | `USER KPDM` | Pure display-label switch ("% PSSP User" vs "% PSSP KPDM") — doesn't change the underlying formula |
| `StatusStandarisasi` | `SUDAH_STANDARISASI PROSES_PENGAJUAN BELUM_STANDARISASI TIDAK_TAHU` | "Listing Corporate" status |

### PSSP contract & discount system

- **`PsspKontrak`** — main PSSP contract history, one row per (`cUrut` ×
  `kdProduk`), per-period JSONB maps for estimate/BM/pelunasan. Imported via
  `scripts/importPsspKontrak.ts`.
- **`DiskonKontrak`** (DPL — Diskon Penjualan Langsung) — **PRIMARY** source
  for "% Diskon (DPL/DPF)". One row per (`nomor` × `kodeProduk`); `newOnPi`
  is the effective on-invoice discount %. Imported via `scripts/importDpl.ts`
  from `internal/DPL <bulan tahun>.xlsx`.
- **`DiskonHistory`** — **FALLBACK** source, used only when no `DiskonKontrak`
  row covers an outlet+product+period. Stores `maxDiskonPct` — the highest
  single-invoice % seen historically (not a weighted average — changed
  2026-07-28 per business request). Not period-scoped. Imported via
  `scripts/importDiskonHistory.ts`.

Resolution logic lives in `LineItemEditor.tsx`
(`resolveDiskonContract`/`resolveDiskonPctWithHistory`/`resolveDiskonPeriodLabel`):
DPL is always tried first (largest `newOnPi` wins on a tie); `DiskonHistory`
is only ever a last resort. The UI shows which source backed the resolved %
("DPL periode X-Y" vs "Historis (tidak terikat periode kontrak)").

---

## Key Pages

| Route | Who sees it | Purpose |
|---|---|---|
| `/dashboard` | All | POA list; managers see MR submit-progress stats + Excel export button |
| `/poa/new` | MR | Create a new quarterly draft |
| `/poa/[id]` | All | View POA detail; approve / Ajukan Edit buttons |
| `/poa/[id]/edit` | MR (unless edit-locked) | Edit line items |
| `/approvals` | ASM/SM/NSM | Inbox of POAs awaiting action; SM/NSM can bulk-approve |
| `/summary` | ASM/SM/NSM/ADMIN/SFE | Aggregate stats — Per Outlet/Customer/Produk/Personil tabs, period-range filter, GAP/Estimasi sort toggle, Growth vs Quarter Sebelumnya |
| `/admin` | ADMIN | User/Outlet/Dokter/Produk/Assignment/POA CRUD + dummy account generator |
| `/admin/target-produk` | ADMIN | Top-down target allocation drilldown (NSM→SM→ASM→MR) |

---

## Excel Exports

### Single POA — `GET /api/poa/[id]/export`

Sheets: **Summary** · **Pengisian** (one row per line item — includes Status
User, Historis PSSP, Jenis PSSP, Keterangan Produk among ~50 columns) ·
**PSSP Aktif** · **Audit Log**. Only available for non-DRAFT POAs.

### Team Bulk — `GET /api/export/team?period=2026-Q3`

Available to ASM/SM/NSM from the Dashboard. Sheets: **Ringkasan Tim** ·
**Per MR** · **Semua Pengajuan** · **PSSP Aktif** · **Summary Per Outlet** ·
**Summary by Produk**.

---

## Key Architecture Decisions

### Auth
- Login by NIP only — no password. `isActive` is the *only* thing that gates
  login (`verifyNip` in `lib/auth.ts`); `isDummy` no longer blocks login.
  Session encrypted with `iron-session` (httpOnly cookie, 30-day lifetime).

### Authorization
- All permission checks go through `lib/authz.ts` — `canView`, `canEdit`,
  `canApprove`, `getVisiblePoaFilter`, `getSubordinateMRNips`,
  `getEditLockLevel`, `canRequestEdit`/`canRespondEditRequest`.
- Never write ad-hoc `where: { ownerId: userId }` without going through
  these functions.

### `isDummy` vs `isActive`
- `isActive` gates login (see Auth above).
- `isDummy` grants national/all-outlet access — bypasses `MrOutletAssignment`
  entirely in `getOutletsByUser` (`lib/masterData.ts`) and `canCreatePoa`
  (`lib/authz.ts`). `ADMIN` gets the same all-outlet treatment. Non-dummy
  ASM/SM/NSM can still create a POA via a separate, narrower "vacant team"
  exception (`Outlet.coveredByNip`/`coveredByRole`).
- The Admin panel's "Buat Akun Dummy" form (and
  `scripts/generateDummyAccounts.ts` / `scripts/addNationalDummyUsers.ts`)
  generate a self-contained `MR{digits}/ASM{digits}/SM{digits}/NSM{digits}`
  chain from one reference NIP's digit suffix, all `isDummy: true`, refusing
  to overwrite a NIP already used by a real account.

### State Machine
- All `PoaForm.status` mutations go through `lib/poaWorkflow.ts`. Never
  update `status` directly elsewhere.

### POA Period Format
- Period is stored as `"YYYY-Q#"` (e.g. `"2026-Q3"`), not monthly — this
  format is lexicographically sortable, which the Summary page's period-range
  filter (`gte`/`lte`) relies on directly.
- Line item `periodeAwal` is `"YYYYMM"` (e.g. `"202607"`) — use
  `formatPeriode()` to display.

### Currency formatting
- Dashboard/Summary/export-facing displays abbreviate as `"1,2 Jt"` / `"3 Rb"`
  / `"1,5 M"` — **no `"Rp"` prefix** (dropped 2026-07-28). Each of
  `AdminTabs.tsx`, `poa/[id]/page.tsx`, `dashboard/page.tsx`,
  `pm-dashboard/page.tsx`, `MonitoringChecklist.tsx`, `DraftChecklist.tsx`
  (`formatRp`/`formatRpPssp`), `TerritoryTable.tsx` has its own local
  `formatRp` with this shape — keep them consistent if you touch one.
  `LineItemEditor.tsx` and `TargetProdukForm.tsx` intentionally still use
  plain `"Rp " + toLocaleString()` with no abbreviation (precise
  calculator/target figures, not dashboard aggregates) — don't "fix" those
  to match without checking first.
- Per-product unit labels use `satuanLabel(product)` (real `Product.satuan`,
  e.g. "BOX"), falling back to generic "SJ" only when no real unit is synced.

### MSSQL Sync
- Trigger externally: `POST /api/sync/org-structure` with `X-Sync-Secret`
  header (also `/api/sync/sales-history`, `/api/sync/sales-value-monthly`)
- Or manually via the `npm run sync:*` scripts / `scripts/sync*.ts` directly

### Email
- Currently mocks to console. Replace `sendEmail()` in `lib/notifications.ts`
  to go live. Used for status-change and edit-request notifications.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build:production` / `:staging` / `:development` | Environment-specific production build |
| `npm run lint` | ESLint |
| `npx prisma generate` | Regenerate Prisma client after schema changes |
| `npm run db:migrate:dev` | Apply schema migrations (local) |
| `npm run db:migrate` | Apply schema migrations (staging/production, `migrate deploy`) |
| `npm run db:studio` | Visual DB browser |
| `npm run sync:org` / `sync:products` / `sync:customers` | Manual MSSQL sync (org / product master / customer master) |
| `npm run mock:generate` | Regenerate `src/lib/mock/generated-data.json` from source Excel/CSV |
| `npm run seed:local` | Seed a local Postgres DB from that JSON (`USE_MOCK_DB` workflow) |

Other one-off/repeatable scripts in `scripts/` (run via `npx tsx scripts/<name>.ts`):

- **Org/outlet structure**: `syncOrg.ts` (org hierarchy → `User`, runs the
  full sync in the right order), `importStrukturHospital.ts` (current
  combined KAM-1 + Hospinet roster), `importStrukturVerifiedKAM.ts`
  (superseded, KAM-only), `matchStrukturBaruFromMssql.ts` /
  `compareNexusVsStrukturBaru.ts` / `promoteStrukturBaruOutletMapping.ts`
  (draft 2026 org-restructure staging/promotion pipeline),
  `updateOutletGroupRS.ts`.
- **Product master**: `syncProducts.ts` (primary, password-protected HNA
  file), `importHnaProducts.ts` (from pre-extracted JSON),
  `syncNilaiR.ts`, `syncSatuanTerkecil.ts`, `syncProductZatAktifDosis.ts`,
  `fixNarfoz4InjeksiKonversi.ts` (one-off single-product fix),
  `importProductSpesialisasiRekomendasi.ts` (per-product specialty
  relevance → `Product.spesialisasiRekomendasi`, filters the "Listing
  Corporate" sections in the Produk Rekomendasi panel).
- **PSSP / discount / survey / listing fee**: `importPsspKontrak.ts`,
  `importPsspHospinet.ts`, `importDpl.ts` (DPL — primary discount source),
  `importDiskonHistory.ts` (fallback discount source, max not average),
  `importSurveyRekomendasi.ts`, `importListingFee.ts`.
- **Sales data**: `syncSalesHistory.ts` (rolling 12-month total),
  `syncSalesHistoryMonthly.ts` (monthly quantity, feeds
  `targetCalculation.ts`), `syncOutletSalesValueMonthly.ts` (outlet-level
  monthly Rupiah value).
- **Kriteria/target seed**: `seedOutletProductKriteria.ts`.
- **Dummy accounts**: `generateDummyAccounts.ts` (bulk, one chain per real
  employee), `addNationalDummyUsers.ts` (named individuals — script version
  of the Admin UI form).
- **One-off migrations**: `migratePengaliNilaiRToCustomerLevel.ts`.
