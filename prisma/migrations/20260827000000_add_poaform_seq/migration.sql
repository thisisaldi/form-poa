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
-- setval's value must be >= 1 (sequence minvalue) — on an EMPTY table
-- (shadow DB `migrate dev` always builds from scratch, or any fresh
-- dev/CI database) MAX("seq") is NULL, so plain COALESCE(...,0) fails
-- with "value 0 is out of bounds". GREATEST(...,1) + is_called=false
-- makes an empty table behave like a freshly-created sequence (next
-- nextval() returns 1), while a populated table still advances past
-- its actual max seq (is_called=true → next nextval() returns max+1).
SELECT setval(
  '"PoaForm_seq_seq"',
  GREATEST(COALESCE((SELECT MAX("seq") FROM "PoaForm"), 0), 1),
  COALESCE((SELECT MAX("seq") FROM "PoaForm"), 0) > 0
);

ALTER TABLE "PoaForm" ALTER COLUMN "seq" SET DEFAULT nextval('"PoaForm_seq_seq"');
ALTER TABLE "PoaForm" ALTER COLUMN "seq" SET NOT NULL;
ALTER TABLE "PoaForm" ADD CONSTRAINT "PoaForm_seq_key" UNIQUE ("seq");
