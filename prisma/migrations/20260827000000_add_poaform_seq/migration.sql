-- AlterTable: add a global, never-reset sequential number to PoaForm for the
-- human-readable "POA0001" id Exodus needs. Existing rows are backfilled in
-- createdAt order (not physical row order) so the numbering matches actual
-- creation history.
ALTER TABLE "PoaForm" ADD COLUMN "seq" INTEGER;

UPDATE "PoaForm" p
SET "seq" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "PoaForm"
) sub
WHERE p.id = sub.id;

CREATE SEQUENCE "PoaForm_seq_seq" OWNED BY "PoaForm"."seq";
SELECT setval('"PoaForm_seq_seq"', COALESCE((SELECT MAX("seq") FROM "PoaForm"), 0));

ALTER TABLE "PoaForm" ALTER COLUMN "seq" SET DEFAULT nextval('"PoaForm_seq_seq"');
ALTER TABLE "PoaForm" ALTER COLUMN "seq" SET NOT NULL;
ALTER TABLE "PoaForm" ADD CONSTRAINT "PoaForm_seq_key" UNIQUE ("seq");
