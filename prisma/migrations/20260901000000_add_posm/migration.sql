-- CreateTable
CREATE TABLE "POSM" (
    "id" TEXT NOT NULL,
    "refID" TEXT NOT NULL,
    "pi_code" TEXT NOT NULL,
    "Status" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "placementDate" TIMESTAMP(3) NOT NULL,
    "visibilityPeriod" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POSM_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "POSM_refID_key" ON "POSM"("refID");