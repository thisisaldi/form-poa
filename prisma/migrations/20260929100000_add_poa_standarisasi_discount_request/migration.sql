-- Riwayat ajuan DPL/DPF POA Standarisasi yang dikirim ke Exodus.
CREATE TABLE "PoaStandarisasiDiscountRequest" (
    "id" TEXT NOT NULL,
    "pengajuanId" TEXT NOT NULL,
    "tipe" TEXT NOT NULL,
    "distributorKode" TEXT NOT NULL,
    "requestDocNumber" TEXT,
    "requestDocDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "produk" JSONB NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "submittedByNip" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoaStandarisasiDiscountRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PoaStandarisasiDiscountRequest_pengajuanId_dedupKey_key" ON "PoaStandarisasiDiscountRequest"("pengajuanId", "dedupKey");
CREATE INDEX "PoaStandarisasiDiscountRequest_pengajuanId_idx" ON "PoaStandarisasiDiscountRequest"("pengajuanId");

ALTER TABLE "PoaStandarisasiDiscountRequest" ADD CONSTRAINT "PoaStandarisasiDiscountRequest_pengajuanId_fkey" FOREIGN KEY ("pengajuanId") REFERENCES "PoaStandarisasi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiDiscountRequest" ADD CONSTRAINT "PoaStandarisasiDiscountRequest_submittedByNip_fkey" FOREIGN KEY ("submittedByNip") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;
