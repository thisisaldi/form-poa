-- CreateTable
CREATE TABLE "PsspHospinetSnapshot" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "statusCustomer" TEXT NOT NULL,
    "psspBerjalan" BOOLEAN NOT NULL,
    "valuePssp" DECIMAL(18,2) NOT NULL,
    "pelunasan" DECIMAL(18,2) NOT NULL,
    "rr" DECIMAL(10,4),
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PsspHospinetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PsspHospinetSnapshot_kodePI_idx" ON "PsspHospinetSnapshot"("kodePI");

-- CreateIndex
CREATE UNIQUE INDEX "PsspHospinetSnapshot_customerId_kodePI_key" ON "PsspHospinetSnapshot"("customerId", "kodePI");

-- AddForeignKey
ALTER TABLE "PsspHospinetSnapshot" ADD CONSTRAINT "PsspHospinetSnapshot_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsspHospinetSnapshot" ADD CONSTRAINT "PsspHospinetSnapshot_kodePI_fkey" FOREIGN KEY ("kodePI") REFERENCES "Outlet"("kodePI") ON DELETE CASCADE ON UPDATE CASCADE;
