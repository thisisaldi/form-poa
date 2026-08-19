-- CreateTable
CREATE TABLE "PoaDoctorsApiCredential" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordSalt" TEXT NOT NULL,
    "updatedByNip" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaDoctorsApiCredential_pkey" PRIMARY KEY ("id")
);
