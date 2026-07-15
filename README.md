# POA System

Internal web application for managing hierarchical Plan of Action (POA) approval workflows in a pharmaceutical sales organization.

## Organizational Hierarchy

```
MR (Medical Representative)
  └── ASM (Area Sales Manager)
        └── SM (Sales Manager)
              └── NSM (National Sales Manager)
```

## POA Workflow

```
DRAFT → SUBMITTED_TO_ASM → APPROVED_BY_ASM → SUBMITTED_TO_SM
      → APPROVED_BY_SM → SUBMITTED_TO_NSM → APPROVED_BY_NSM
```

- MR creates a draft and fills in line items (product × doctor combinations)
- MR submits → ASM receives and can review/approve
- ASM approves → SM → NSM
- Once submitted, the previous level can only view read-only
- DRAFT POAs cannot be exported to Excel

---

## Setup

### 1. Prerequisites

- Node.js 18+
- PostgreSQL (running locally or remote)
- MSSQL (for org sync — stub works without it in development)

### 2. Environment Variables

```bash
cp .env.example .env
# Edit .env and fill in DATABASE_URL, SESSION_SECRET at minimum
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `MSSQL_CONNECTION_STRING` | Yes | MSSQL source DB (org hierarchy) |
| `SESSION_SECRET` | Yes | Min 32 chars — used to encrypt sessions |
| `EMAIL_FROM` | No | Sender address (mock email by default) |
| `RESEND_API_KEY` | No | Resend API key (once email provider is wired) |
| `SYNC_SECRET` | No | Shared secret for `/api/sync/org-structure` |

### 3. Database Setup

```bash
npm install

# Generate Prisma client
npx prisma generate

# Run migrations (creates tables)
npx prisma migrate dev
```

### 4. Seed Users

Users are created via the MSSQL sync job. For development, run:

```bash
npx tsx scripts/syncOrg.ts
```

For dummy POA data under a specific NSM:

```bash
node scripts/seed-dummy.mjs
```

### 5. Run Development Server

```bash
npm run dev
# Open http://localhost:3000
# Login with NIP of any seeded user
```

---

## Project Structure

```
src/
├── app/
│   ├── (auth)/login/           # NIP login page
│   ├── (app)/                  # Authenticated shell (sidebar layout)
│   │   ├── dashboard/          # Role-aware POA list + MR progress stats
│   │   ├── poa/
│   │   │   ├── new/            # Create draft (MR only)
│   │   │   └── [id]/
│   │   │       ├── page.tsx    # Detail / view / approve
│   │   │       ├── edit/       # Edit draft
│   │   │       └── items/      # Line item management
│   │   ├── approvals/          # Manager inbox
│   │   └── summary/            # POA summary stats for managers (formerly /monitoring)
│   ├── api/
│   │   ├── auth/logout/        # POST — destroy session
│   │   ├── export/team/        # GET — bulk Excel for NSM/SM/ASM
│   │   ├── poa/[id]/export/    # GET — single POA Excel download
│   │   └── sync/org-structure/ # POST — trigger MSSQL sync
│   └── actions/                # Server Actions (mutations)
├── lib/
│   ├── env.ts                  # Zod-validated env vars
│   ├── prisma.ts               # Singleton Prisma client
│   ├── session.ts              # iron-session setup
│   ├── auth.ts                 # Identity verification (NIP lookup)
│   ├── authz.ts                # Permission checks (canView/canEdit/getSubordinateMRNips)
│   ├── poaWorkflow.ts          # State machine — all status transitions
│   ├── poaUtils.ts             # Period helpers (formatPeriode, computePeriodeAkhir)
│   ├── masterData.ts           # Product & outlet master data
│   ├── paketProduk.ts          # Fokus product paket lookup
│   ├── spesialisasi.ts         # Doctor specialization label mapping
│   ├── notifications.ts        # Email abstraction (mock → swap provider)
│   └── sync/
│       └── orgStructureSync.ts # MSSQL → PostgreSQL user sync
├── components/
│   ├── layout/Sidebar.tsx
│   ├── poa/
│   │   ├── DraftChecklist.tsx      # Stats panel for MR draft view
│   │   ├── LineItemEditor.tsx      # Line item add/edit form
│   │   └── MonitoringChecklist.tsx # Summary stats card for managers
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Combobox.tsx
│       └── StatusBadge.tsx
scripts/
├── syncOrg.ts                  # Standalone org sync script
├── seed-dummy.mjs              # Seed dummy POA data for testing
├── seedOutletProductKriteria.ts
└── syncNilaiR.ts
prisma/
└── schema.prisma
```

---

## Key Pages

| Route | Who sees it | Purpose |
|---|---|---|
| `/dashboard` | All | POA list; managers see MR submit-progress stats + Excel export button |
| `/poa/new` | MR | Create a new quarterly draft |
| `/poa/[id]` | All | View POA detail; approve buttons for managers |
| `/poa/[id]/edit` | MR (DRAFT only) | Edit line items |
| `/approvals` | ASM/SM/NSM | Inbox of POAs awaiting action |
| `/summary` | ASM/SM/NSM/ADMIN | Aggregate stats across all subordinate MRs, filterable by period and territory tab |

---

## Excel Exports

### Single POA — `GET /api/poa/[id]/export`
Sheets: Summary · Line Items · Audit Log. Only available for non-DRAFT POAs.

### Team Bulk — `GET /api/export/team?period=2026-Q3`
Available to ASM/SM/NSM from the Dashboard. Sheets:
1. **Ringkasan Tim** — aggregate totals (submit progress, estimasi, anggaran, cakupan, listing)
2. **Per MR** — one row per MR with full hierarchy (NIP/Nama ASM/SM/NSM) and key metrics
3. **Semua Pengajuan** — every line item with NSM/SM/ASM hierarchy columns, `spesialisasi` display label, Total Budget and Warning Budget per row

---

## Key Architecture Decisions

### Auth
- Login by NIP only (no password). Session encrypted with `iron-session` (httpOnly cookie, 30-day lifetime).
- `lib/auth.ts` is the single identity-check gate.

### Authorization
- All permission checks go through `lib/authz.ts` — `canView`, `canEdit`, `getVisiblePoaFilter`, `getSubordinateMRNips`.
- Never write ad-hoc `where: { ownerId: userId }` without going through these functions.
- Hierarchy resolution is always dynamic against current `User.nipAtasan` — org changes propagate automatically.

### State Machine
- All `PoaForm.status` mutations go through `lib/poaWorkflow.ts`. Never update `status` directly elsewhere.

### POA Period Format
- Period is stored as `"YYYY-Q#"` (e.g. `"2026-Q3"`), not monthly.
- Line item `periodeAwal` is `"YYYYMM"` (e.g. `"202607"`) — use `formatPeriode()` to display.

### MSSQL Sync
- Trigger externally: `POST /api/sync/org-structure` with `X-Sync-Secret` header
- Or manually: `npx tsx scripts/syncOrg.ts`

### Email
- Currently mocks to console. Replace `sendEmail()` in `lib/notifications.ts` to go live.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server |
| `npx prisma generate` | Regenerate Prisma client after schema changes |
| `npx prisma migrate dev` | Apply schema migrations |
| `npx prisma studio` | Visual DB browser |
| `npx tsx scripts/syncOrg.ts` | Manual org sync from MSSQL |
| `node scripts/seed-dummy.mjs` | Seed dummy POA data for testing |
| `npx tsx scripts/syncNilaiR.ts` | Sync nilai-R from external source |
