-- ====================================================================
-- 1. PoaScProductItem: Tambah periodeMonth, Backfill, dan Unique Baru
-- ====================================================================

-- 1.1 Tambah kolom periodeMonth (nullable terlebih dahulu)
ALTER TABLE "PoaScProductItem" ADD COLUMN IF NOT EXISTS "periodeMonth" TEXT;

-- 1.2 Backfill data existing dari periodeAwal milik PoaScForm
UPDATE "PoaScProductItem" p
SET "periodeMonth" = f."periodeAwal"
FROM "PoaScForm" f
WHERE p."poaScId" = f."id" AND (p."periodeMonth" IS NULL OR p."periodeMonth" = '');

-- Fallback jika ada baris orphan tanpa periodeAwal
UPDATE "PoaScProductItem"
SET "periodeMonth" = '202607'
WHERE "periodeMonth" IS NULL OR "periodeMonth" = '';

-- 1.3 Jadikan NOT NULL
ALTER TABLE "PoaScProductItem" ALTER COLUMN "periodeMonth" SET NOT NULL;

-- 1.4 Drop unique constraint lama & index redundant pada PoaScProductItem
ALTER TABLE "PoaScProductItem" DROP CONSTRAINT IF EXISTS "PoaScProductItem_poaScId_kodeProduk_key";
ALTER TABLE "PoaScProductItem" DROP CONSTRAINT IF EXISTS "PoaScProductItem_poaScId_kodeProduk_periodeMonth_key";
DROP INDEX IF EXISTS "PoaScProductItem_poaScId_idx";
DROP INDEX IF EXISTS "PoaScProductItem_poaScId_periodeMonth_idx";

-- 1.5 Tambahkan unique constraint baru yang optimal: (poaScId, periodeMonth, kodeProduk)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PoaScProductItem_poaScId_periodeMonth_kodeProduk_key'
  ) THEN
    ALTER TABLE "PoaScProductItem" ADD CONSTRAINT "PoaScProductItem_poaScId_periodeMonth_kodeProduk_key" 
    UNIQUE ("poaScId", "periodeMonth", "kodeProduk");
  END IF;
END $$;

-- ====================================================================
-- 2. PoaScPersonItem: Rename nik_ktp -> outletPersonId & Drop Index Redundant
-- ====================================================================

-- 2.1 Rename column nik_ktp to outletPersonId jika masih bernama nik_ktp
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'PoaScPersonItem' AND column_name = 'nik_ktp'
  ) THEN
    ALTER TABLE "PoaScPersonItem" RENAME COLUMN "nik_ktp" TO "outletPersonId";
  END IF;
END $$;

-- 2.2 Drop index redundant pada PoaScPersonItem
DROP INDEX IF EXISTS "PoaScPersonItem_poaScId_idx";

-- 2.3 Perbarui unique constraint untuk menggunakan outletPersonId
ALTER TABLE "PoaScPersonItem" DROP CONSTRAINT IF EXISTS "PoaScPersonItem_poaScId_nik_ktp_key";
DO $$
BEGIN   
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PoaScPersonItem_poaScId_outletPersonId_key'
  ) THEN
    ALTER TABLE "PoaScPersonItem" ADD CONSTRAINT "PoaScPersonItem_poaScId_outletPersonId_key" 
    UNIQUE ("poaScId", "outletPersonId");
  END IF;
END $$;
