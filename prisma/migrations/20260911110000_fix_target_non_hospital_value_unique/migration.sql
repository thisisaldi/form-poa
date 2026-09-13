-- namaGT is NOT globally unique across divisi in the real source data (see schema doc comment) — widen the unique key.
DROP INDEX "TargetNonHospitalValue_namaGT_periode_key";
CREATE UNIQUE INDEX "TargetNonHospitalValue_namaGT_divisi_periode_key" ON "TargetNonHospitalValue"("namaGT", "divisi", "periode");
