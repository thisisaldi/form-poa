-- CreateTable
CREATE TABLE "OutletProductKriteria" (
    "id" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "paket" TEXT NOT NULL,
    "kategori" TEXT NOT NULL,
    "kriteriaBaru" TEXT NOT NULL,
    "statusTransaksi" INTEGER NOT NULL,

    CONSTRAINT "OutletProductKriteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutletProductKriteria_kodePI_idx" ON "OutletProductKriteria"("kodePI");

-- CreateIndex
CREATE INDEX "OutletProductKriteria_kodeProduk_idx" ON "OutletProductKriteria"("kodeProduk");

-- CreateIndex
CREATE UNIQUE INDEX "OutletProductKriteria_kodePI_kodeProduk_paket_key" ON "OutletProductKriteria"("kodePI", "kodeProduk", "paket");
