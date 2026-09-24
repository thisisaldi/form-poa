-- HR master NIP -> name/PTID, for KPI Monitoring to follow people across NIP changes.
CREATE TABLE "sipp_employees" (
    "nip" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "namaNormalized" TEXT NOT NULL,
    "ptid" INTEGER NOT NULL,
    "tglMasuk" TIMESTAMP(3),
    "tglKeluar" TIMESTAMP(3),

    CONSTRAINT "sipp_employees_pkey" PRIMARY KEY ("nip")
);

CREATE INDEX "sipp_employees_namaNormalized_idx" ON "sipp_employees"("namaNormalized");
