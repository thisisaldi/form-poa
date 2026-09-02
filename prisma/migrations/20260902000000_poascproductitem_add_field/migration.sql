ALTER TABLE "PoaScProductItem" DROP COLUMN "pembeliHari";
ALTER TABLE "PoaScProductItem" DROP COLUMN "qtyCustomerBaru";
ALTER TABLE "PoaScProductItem" ADD COLUMN "qtyPerBulan" INTEGER NOT NULL DEFAULT 0;