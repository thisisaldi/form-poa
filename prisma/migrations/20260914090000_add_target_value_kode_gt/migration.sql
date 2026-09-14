-- Add kodeGT to both target value tables — see Prisma schema doc comments (TargetHospitalValue's is mostly null due to an upstream Outlet.kodeGT sync gap; TargetNonHospitalValue's is reliably populated from the source workbook's STRUKTUR sheet).
ALTER TABLE "TargetHospitalValue" ADD COLUMN "kodeGT" TEXT;
CREATE INDEX "TargetHospitalValue_kodeGT_idx" ON "TargetHospitalValue"("kodeGT");

ALTER TABLE "TargetNonHospitalValue" ADD COLUMN "kodeGT" TEXT;
CREATE INDEX "TargetNonHospitalValue_kodeGT_idx" ON "TargetNonHospitalValue"("kodeGT");
