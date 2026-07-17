-- CreateTable
CREATE TABLE "OutletStrukturBaru" (
    "id" TEXT NOT NULL,
    "kodePI" TEXT NOT NULL,
    "namaOutlet" TEXT,
    "area" TEXT,
    "gmNama" TEXT,
    "nsmNama" TEXT,
    "smNama" TEXT,
    "asmNama" TEXT,
    "spvNama" TEXT,
    "psrNama" TEXT,
    "gmNip" TEXT,
    "nsmNip" TEXT,
    "smNip" TEXT,
    "asmNip" TEXT,
    "spvNip" TEXT,
    "psrNip" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutletStrukturBaru_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutletStrukturBaru_kodePI_idx" ON "OutletStrukturBaru"("kodePI");

-- CreateIndex
CREATE INDEX "OutletStrukturBaru_gmNip_idx" ON "OutletStrukturBaru"("gmNip");

-- CreateIndex
CREATE INDEX "OutletStrukturBaru_nsmNip_idx" ON "OutletStrukturBaru"("nsmNip");

-- CreateIndex
CREATE INDEX "OutletStrukturBaru_smNip_idx" ON "OutletStrukturBaru"("smNip");

-- CreateIndex
CREATE INDEX "OutletStrukturBaru_asmNip_idx" ON "OutletStrukturBaru"("asmNip");

-- CreateIndex
CREATE INDEX "OutletStrukturBaru_spvNip_idx" ON "OutletStrukturBaru"("spvNip");

-- CreateIndex
CREATE INDEX "OutletStrukturBaru_psrNip_idx" ON "OutletStrukturBaru"("psrNip");

