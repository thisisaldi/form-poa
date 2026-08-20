-- CreateTable
CREATE TABLE "PoaScForm" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "periodeAwal" TEXT NOT NULL,
    "lamaPeriode" INTEGER NOT NULL,
    "status" "PoaStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "kodePI" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "currentHolderId" TEXT,

    CONSTRAINT "PoaScForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaScProductItem" (
    "id" TEXT NOT NULL,
    "poaScId" TEXT NOT NULL,
    "kodeProduk" TEXT NOT NULL,
    "namaProduk" TEXT NOT NULL,
    "produkKompetitor" TEXT,
    "pembeliHari" INTEGER NOT NULL,
    "qtyCustomerBaru" INTEGER NOT NULL,
    "persenMatriksSc" DECIMAL(5,2) NOT NULL,
    "persenDiskon" DECIMAL(5,2) NOT NULL,
    "persenCashback" DECIMAL(5,2) NOT NULL,
    "rencanaTotalBiaya" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaScProductItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaScPersonItem" (
    "id" TEXT NOT NULL,
    "poaScId" TEXT NOT NULL,
    "nik_ktp" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "positionName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaScPersonItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaScEntertainItem" (
    "id" TEXT NOT NULL,
    "poaScId" TEXT NOT NULL,
    "periodeMonth" TEXT NOT NULL,
    "biayaEntertain" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoaScEntertainItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoaScAuditLog" (
    "id" TEXT NOT NULL,
    "poaScId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "fromStatus" "PoaStatus",
    "toStatus" "PoaStatus",
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoaScAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PoaScForm_ownerId_idx" ON "PoaScForm"("ownerId");

-- CreateIndex
CREATE INDEX "PoaScForm_currentHolderId_idx" ON "PoaScForm"("currentHolderId");

-- CreateIndex
CREATE INDEX "PoaScForm_status_idx" ON "PoaScForm"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PoaScForm_kodePI_periodeAwal_ownerId_key" ON "PoaScForm"("kodePI", "periodeAwal", "ownerId");

-- CreateIndex
CREATE INDEX "PoaScProductItem_poaScId_idx" ON "PoaScProductItem"("poaScId");

-- CreateIndex
CREATE UNIQUE INDEX "PoaScProductItem_poaScId_kodeProduk_key" ON "PoaScProductItem"("poaScId", "kodeProduk");

-- CreateIndex
CREATE INDEX "PoaScPersonItem_poaScId_idx" ON "PoaScPersonItem"("poaScId");

-- CreateIndex
CREATE UNIQUE INDEX "PoaScPersonItem_poaScId_nik_ktp_key" ON "PoaScPersonItem"("poaScId", "nik_ktp");

-- CreateIndex
CREATE UNIQUE INDEX "PoaScEntertainItem_poaScId_periodeMonth_key" ON "PoaScEntertainItem"("poaScId", "periodeMonth");

-- CreateIndex
CREATE INDEX "PoaScAuditLog_poaScId_idx" ON "PoaScAuditLog"("poaScId");

-- AddForeignKey
ALTER TABLE "PoaScForm" ADD CONSTRAINT "PoaScForm_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaScForm" ADD CONSTRAINT "PoaScForm_currentHolderId_fkey" FOREIGN KEY ("currentHolderId") REFERENCES "User"("nip") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaScProductItem" ADD CONSTRAINT "PoaScProductItem_poaScId_fkey" FOREIGN KEY ("poaScId") REFERENCES "PoaScForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaScPersonItem" ADD CONSTRAINT "PoaScPersonItem_poaScId_fkey" FOREIGN KEY ("poaScId") REFERENCES "PoaScForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaScEntertainItem" ADD CONSTRAINT "PoaScEntertainItem_poaScId_fkey" FOREIGN KEY ("poaScId") REFERENCES "PoaScForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaScAuditLog" ADD CONSTRAINT "PoaScAuditLog_poaScId_fkey" FOREIGN KEY ("poaScId") REFERENCES "PoaScForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoaScAuditLog" ADD CONSTRAINT "PoaScAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;
