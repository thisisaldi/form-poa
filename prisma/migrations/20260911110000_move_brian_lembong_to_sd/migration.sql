-- DataMigration: Brian Lembong (P200134) moves from GM to the new SD role —
-- docs/exodus-poa-usage/01-business-rules.md §11 (2026-09-09 decision).
-- Split into its own migration (2026-09-11) — PostgreSQL forbids using a
-- brand-new enum value ('SD', added in 20260909130000_add_asd_sd_approval_level)
-- within the same transaction that added it ("unsafe use of new value").
UPDATE "User" SET "role" = 'SD' WHERE "nip" = 'P200134';
