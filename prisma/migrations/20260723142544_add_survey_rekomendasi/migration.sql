-- CreateTable
CREATE TABLE "SurveyRekomendasi" (
    "id" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "kodeCustomer" TEXT NOT NULL,
    "namaCustomer" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "namaProdukRekomendasi" TEXT NOT NULL,
    "zatAktif" TEXT,
    "dosageForm" TEXT,
    "kodeSpesialis" TEXT,
    "spesialis" TEXT,
    "potensiBulan" DECIMAL(10,2),
    "historyProduk" TEXT NOT NULL,
    "statusSales" TEXT,
    "statusPssp" TEXT,
    "metodePemilihan" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurveyRekomendasi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SurveyRekomendasi_kodePI_kodeCustomer_idx" ON "SurveyRekomendasi"("kodePI", "kodeCustomer");

-- CreateIndex
CREATE UNIQUE INDEX "SurveyRekomendasi_kodePI_kodeCustomer_kodeProduk_key" ON "SurveyRekomendasi"("kodePI", "kodeCustomer", "kodeProduk");

-- AddForeignKey
ALTER TABLE "SurveyRekomendasi" ADD CONSTRAINT "SurveyRekomendasi_kodePI_fkey" FOREIGN KEY ("kodePI") REFERENCES "Outlet"("kodePI") ON DELETE CASCADE ON UPDATE CASCADE;
