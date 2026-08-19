-- Baseline: "User"."project" was added directly against the database outside
-- of a migration (untracked drift found by `prisma migrate dev` on 2026-08-19).
-- This migration exists only to reconcile migration history with the actual
-- DB state; it is marked applied via `prisma migrate resolve` rather than run,
-- since the column already exists. Whether to keep/model this column properly
-- in schema.prisma or drop it is an open decision, not resolved here.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "project" TEXT;
