-- CreateTable
CREATE TABLE "KpiMonthlyEntry" (
    "id" TEXT NOT NULL,
    "nip" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "salesTargetRp" DECIMAL(18,2),
    "salesActualRp" DECIMAL(18,2),
    "salesAchievementPct" DECIMAL(7,2),
    "callActivityRealisasi" INTEGER,
    "callActivityStandar" INTEGER,
    "callActivitySource" TEXT NOT NULL DEFAULT 'MANUAL',
    "callActivityInputByNip" TEXT,
    "callActivityInputAt" TIMESTAMP(3),
    "customerAktifCount" INTEGER,
    "absensiValue" DECIMAL(6,2),
    "absensiSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "absensiInputByNip" TEXT,
    "absensiInputAt" TIMESTAMP(3),
    "salesScore" INTEGER,
    "activityScore" INTEGER,
    "customerScore" INTEGER,
    "absensiScore" INTEGER,
    "totalScore" DECIMAL(5,2),
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiMonthlyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiContractEvaluation" (
    "id" TEXT NOT NULL,
    "nip" TEXT NOT NULL,
    "periodeMulai" TEXT NOT NULL,
    "periodeAkhir" TEXT NOT NULL,
    "avgSalesScore" DECIMAL(5,2) NOT NULL,
    "avgActivityScore" DECIMAL(5,2) NOT NULL,
    "avgCustomerScore" DECIMAL(5,2) NOT NULL,
    "avgAbsensiScore" DECIMAL(5,2) NOT NULL,
    "totalScore" DECIMAL(5,2) NOT NULL,
    "systemRecommendationMonths" INTEGER NOT NULL,
    "decisionMonths" INTEGER NOT NULL,
    "decisionReason" TEXT,
    "developmentPlanNotes" TEXT NOT NULL,
    "evaluatedByNip" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiContractEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KpiMonthlyEntry_period_idx" ON "KpiMonthlyEntry"("period");

-- CreateIndex
CREATE UNIQUE INDEX "KpiMonthlyEntry_nip_period_key" ON "KpiMonthlyEntry"("nip", "period");

-- CreateIndex
CREATE INDEX "KpiContractEvaluation_nip_idx" ON "KpiContractEvaluation"("nip");

-- CreateIndex
CREATE INDEX "KpiContractEvaluation_evaluatedByNip_idx" ON "KpiContractEvaluation"("evaluatedByNip");

-- AddForeignKey
ALTER TABLE "KpiMonthlyEntry" ADD CONSTRAINT "KpiMonthlyEntry_nip_fkey" FOREIGN KEY ("nip") REFERENCES "User"("nip") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiContractEvaluation" ADD CONSTRAINT "KpiContractEvaluation_nip_fkey" FOREIGN KEY ("nip") REFERENCES "User"("nip") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiContractEvaluation" ADD CONSTRAINT "KpiContractEvaluation_evaluatedByNip_fkey" FOREIGN KEY ("evaluatedByNip") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;

