-- Qty per bulan dalam Satuan Jual, dibulatkan ke atas.
ALTER TABLE "PoaStandarisasiDokterApproval" ADD COLUMN "estimasiQtyUbPerBulan" INTEGER;
ALTER TABLE "PoaStandarisasiDokterUser" ADD COLUMN "estimasiQtyUbPerBulan" INTEGER;

-- Backfill baris existing: ceil(qty ST / konversiPembagi)
UPDATE "PoaStandarisasiDokterApproval" d
SET "estimasiQtyUbPerBulan" = CEIL(d."estimasiQtyPerBulan" / COALESCE(NULLIF(pr."konversiPembagi", 0), 1))
FROM "PoaStandarisasiProduk" sp JOIN "Product" pr ON pr."kodeProduk" = sp."kodeProduk"
WHERE sp.id = d."produkId" AND d."estimasiQtyPerBulan" IS NOT NULL;

UPDATE "PoaStandarisasiDokterUser" d
SET "estimasiQtyUbPerBulan" = CEIL(d."estimasiQtyPerBulan" / COALESCE(NULLIF(pr."konversiPembagi", 0), 1))
FROM "PoaStandarisasiProduk" sp JOIN "Product" pr ON pr."kodeProduk" = sp."kodeProduk"
WHERE sp.id = d."produkId" AND d."estimasiQtyPerBulan" IS NOT NULL;
