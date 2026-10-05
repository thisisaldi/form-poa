-- AlterTable
ALTER TABLE "KpiContractEvaluation" ADD COLUMN "directionRationale" TEXT,
ADD COLUMN "scheme" TEXT NOT NULL DEFAULT 'HOSPITAL';

-- CreateIndex
CREATE UNIQUE INDEX "KpiContractEvaluation_nip_periodeAkhir_key" ON "KpiContractEvaluation"("nip", "periodeAkhir");

-- Score columns become nullable: an evaluation may be saved while a pillar has no score yet
ALTER TABLE "KpiContractEvaluation"
  ALTER COLUMN "avgSalesScore" DROP NOT NULL,
  ALTER COLUMN "avgActivityScore" DROP NOT NULL,
  ALTER COLUMN "avgCustomerScore" DROP NOT NULL,
  ALTER COLUMN "avgAbsensiScore" DROP NOT NULL,
  ALTER COLUMN "totalScore" DROP NOT NULL,
  ALTER COLUMN "systemRecommendationMonths" DROP NOT NULL;
