-- CreateTable
CREATE TABLE "DiskonDplDpf" (
    "id" TEXT NOT NULL,
    "proCode" TEXT NOT NULL,
    "diskon" DECIMAL(10,4) NOT NULL,
    "periode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiskonDplDpf_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiskonDplDpf_proCode_idx" ON "DiskonDplDpf"("proCode");

-- CreateIndex
CREATE INDEX "DiskonDplDpf_periode_idx" ON "DiskonDplDpf"("periode");
