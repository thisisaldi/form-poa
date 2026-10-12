-- docs/poa-deal-addendum/ — gelombang (batch) approval per dokter. Semua data lama otomatis gelombang 1.
ALTER TABLE "PoaLineItem" ADD COLUMN "batch" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PoaDoctorApproval" ADD COLUMN "batch" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "PoaDoctorApproval_poaId_kodePI_namaCust_key";
CREATE UNIQUE INDEX "PoaDoctorApproval_poaId_kodePI_namaCust_batch_key" ON "PoaDoctorApproval"("poaId", "kodePI", "namaCust", "batch");
CREATE INDEX "PoaLineItem_poaId_kodePI_namaCust_batch_idx" ON "PoaLineItem"("poaId", "kodePI", "namaCust", "batch");
