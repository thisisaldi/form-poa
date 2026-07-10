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

- MR creates a draft (only they can see it)
- MR submits → ASM receives it and can review/approve
- ASM submits up → SM, then SM → NSM
- Once submitted, the previous role can only view read-only

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
npx prisma migrate dev --name init
```

### 4. Seed Initial Users

Users are created via the MSSQL sync job. For development, run the sync script (uses stub/mock data):

```bash
npx tsx scripts/syncOrg.ts
```

See [src/lib/sync/orgStructureSync.ts](src/lib/sync/orgStructureSync.ts) for where to wire in the real MSSQL query.

### 5. Run Development Server

```bash
npm run dev
# Open http://localhost:3000
# Login with NIP of any seeded user (e.g. "MR001" from stub data)
```

---

## Project Structure

```
src/
├── app/
│   ├── (auth)/login/           # NIP login page
│   ├── (app)/                  # Authenticated shell (sidebar layout)
│   │   ├── dashboard/          # Role-aware POA list
│   │   ├── poa/
│   │   │   ├── new/            # Create draft (MR only)
│   │   │   └── [id]/
│   │   │       ├── page.tsx    # Detail / view / approve
│   │   │       ├── edit/       # Edit draft
│   │   │       └── finalize/   # Review before submit
│   │   ├── approvals/          # Manager inbox
│   │   └── monitoring/         # Placeholder
│   ├── api/
│   │   ├── auth/logout/        # POST — destroy session
│   │   ├── poa/[id]/export/    # GET — Excel download
│   │   └── sync/org-structure/ # POST — trigger MSSQL sync
│   └── actions/                # Server Actions (mutations)
├── lib/
│   ├── env.ts                  # Zod-validated env vars
│   ├── prisma.ts               # Singleton Prisma client
│   ├── session.ts              # iron-session setup
│   ├── auth.ts                 # Identity verification (NIP lookup)
│   ├── authz.ts                # Permission checks (canView/canEdit/filters)
│   ├── poaWorkflow.ts          # State machine — all status transitions
│   ├── notifications.ts        # Email abstraction (mock → swap provider)
│   └── sync/
│       └── orgStructureSync.ts # MSSQL → PostgreSQL user sync
├── components/
│   ├── layout/Sidebar.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Input.tsx
│       └── StatusBadge.tsx
scripts/
└── syncOrg.ts                  # Standalone sync script
prisma/
└── schema.prisma
```

---

## Key Architecture Decisions

### Auth
- Login by NIP only (no password). Session encrypted with `iron-session` (httpOnly cookie, 30-day lifetime).
- `lib/auth.ts` is the single identity-check gate — swap here when adding OTP or another factor.
- `lib/session.ts` handles session creation/destruction independently.

### Authorization
- **All** permission checks go through `lib/authz.ts` — `canView`, `canEdit`, `getVisiblePoaFilter`.
- Never write ad-hoc `where: { ownerId: userId }` without going through these functions.
- Hierarchy resolution is always dynamic against current `User.reportsToId` — org changes propagate automatically without any re-sync or re-snapshot.

### State Machine
- **All** `PoaForm.status` mutations go through `lib/poaWorkflow.ts`. Never update `status` directly elsewhere.
- Adding `REJECTED` / revision-request: extend `SUBMIT_TRANSITIONS` / `APPROVE_TRANSITIONS` maps and add a `rejectPoa()` export.

### MSSQL Sync
- Trigger externally: `POST /api/sync/org-structure` with `X-Sync-Secret` header
- Or manually: `npx tsx scripts/syncOrg.ts`
- Real query goes in `fetchOrgFromMssql()` in `orgStructureSync.ts` — upsert logic in `runOrgSync()` does not need to change.

### Email
- Currently mocks to console. To go live: replace `sendEmail()` in `lib/notifications.ts` with a real provider call.

---

## Adding Real POA Form Fields

When the form schema is defined:

1. Update `PoaForm.data` (Json) — or add typed columns to the Prisma schema
2. Replace placeholder UI in `src/app/(app)/poa/[id]/edit/page.tsx`
3. Add real validation in `submitPoaAction` and in the finalize page
4. Update Excel export in `src/app/api/poa/[id]/export/route.ts`

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start dev server |
| `npx prisma generate` | Regenerate Prisma client after schema changes |
| `npx prisma migrate dev` | Apply schema migrations |
| `npx prisma studio` | Visual DB browser |
| `npx tsx scripts/syncOrg.ts` | Manual org sync from MSSQL |
