-- Evaluasi Kontrak Non-Hospital (docs/evaluasi-kontrak-non-hospital/)
CREATE TABLE "NonHospitalContract" (
    "id" TEXT NOT NULL,
    "nip" TEXT NOT NULL,
    "jabatan" TEXT,
    "cabang" TEXT,
    "periodeBulan" INTEGER,
    "awalKontrak" TIMESTAMP(3) NOT NULL,
    "akhirKontrak" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'IMPORT',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NonHospitalContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NonHospitalMonthlyEntry" (
    "id" TEXT NOT NULL,
    "nip" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "scMenang" INTEGER,
    "absensiHariTelat" INTEGER,
    "updatedByNip" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NonHospitalMonthlyEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KpiNonHospitalEvaluation" (
    "id" TEXT NOT NULL,
    "nip" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "windowMulai" TEXT NOT NULL,
    "windowAkhir" TEXT NOT NULL,
    "indicators" JSONB NOT NULL,
    "totalScore" DECIMAL(5,2),
    "dataNotes" TEXT,
    "systemRecommendationMonths" INTEGER,
    "status" TEXT NOT NULL,
    "decisionMonths" INTEGER NOT NULL,
    "decisionReason" TEXT,
    "developmentPlanNotes" TEXT NOT NULL,
    "decidedByNip" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiNonHospitalEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NonHospitalContract_nip_akhirKontrak_key" ON "NonHospitalContract"("nip", "akhirKontrak");
CREATE INDEX "NonHospitalContract_akhirKontrak_idx" ON "NonHospitalContract"("akhirKontrak");
CREATE UNIQUE INDEX "NonHospitalMonthlyEntry_nip_period_key" ON "NonHospitalMonthlyEntry"("nip", "period");
CREATE INDEX "KpiNonHospitalEvaluation_nip_decidedAt_idx" ON "KpiNonHospitalEvaluation"("nip", "decidedAt");
CREATE INDEX "KpiNonHospitalEvaluation_contractId_decidedAt_idx" ON "KpiNonHospitalEvaluation"("contractId", "decidedAt");
CREATE INDEX "KpiNonHospitalEvaluation_decidedByNip_idx" ON "KpiNonHospitalEvaluation"("decidedByNip");

ALTER TABLE "NonHospitalContract" ADD CONSTRAINT "NonHospitalContract_nip_fkey" FOREIGN KEY ("nip") REFERENCES "User"("nip") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NonHospitalMonthlyEntry" ADD CONSTRAINT "NonHospitalMonthlyEntry_nip_fkey" FOREIGN KEY ("nip") REFERENCES "User"("nip") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiNonHospitalEvaluation" ADD CONSTRAINT "KpiNonHospitalEvaluation_nip_fkey" FOREIGN KEY ("nip") REFERENCES "User"("nip") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiNonHospitalEvaluation" ADD CONSTRAINT "KpiNonHospitalEvaluation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "NonHospitalContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KpiNonHospitalEvaluation" ADD CONSTRAINT "KpiNonHospitalEvaluation_decidedByNip_fkey" FOREIGN KEY ("decidedByNip") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;
