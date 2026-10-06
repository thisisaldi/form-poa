-- CreateTable
CREATE TABLE "KpiEvaluationApproval" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "approvedByNip" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiEvaluationApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KpiEvaluationApproval_evaluationId_step_key" ON "KpiEvaluationApproval"("evaluationId", "step");

-- CreateIndex
CREATE INDEX "KpiEvaluationApproval_approvedByNip_idx" ON "KpiEvaluationApproval"("approvedByNip");

-- AddForeignKey
ALTER TABLE "KpiEvaluationApproval" ADD CONSTRAINT "KpiEvaluationApproval_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "KpiContractEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiEvaluationApproval" ADD CONSTRAINT "KpiEvaluationApproval_approvedByNip_fkey" FOREIGN KEY ("approvedByNip") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;
