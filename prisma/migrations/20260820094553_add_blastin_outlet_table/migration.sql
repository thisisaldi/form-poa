-- CreateTable
CREATE TABLE "OutletBlastIn" (
    "kodePI" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletBlastIn_pkey" PRIMARY KEY ("kodePI")
);
