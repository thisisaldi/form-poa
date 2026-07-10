-- CreateTable
CREATE TABLE "Product" (
    "kodeProduk"     TEXT NOT NULL,
    "namaGroupBrand" TEXT NOT NULL,
    "namaProduk"     TEXT NOT NULL,
    "zatAktif"       TEXT,
    "satuan"         TEXT NOT NULL,
    "hna"            DECIMAL(18,2) NOT NULL,
    "syncedAt"       TIMESTAMP(3) NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("kodeProduk")
);

-- CreateIndex
CREATE INDEX "Product_namaGroupBrand_idx" ON "Product"("namaGroupBrand");
