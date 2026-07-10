-- CreateTable: Customer
CREATE TABLE "Customer" (
    "id"           TEXT NOT NULL,
    "kodeCustomer" TEXT,
    "namaCustomer" TEXT NOT NULL,
    "spesialisasi" TEXT NOT NULL,
    "syncedAt"     TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Customer_kodeCustomer_key" ON "Customer"("kodeCustomer");
CREATE INDEX "Customer_spesialisasi_idx" ON "Customer"("spesialisasi");
CREATE INDEX "Customer_namaCustomer_idx" ON "Customer"("namaCustomer");

-- CreateTable: CustomerOutlet
CREATE TABLE "CustomerOutlet" (
    "id"         TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kodePI"     TEXT NOT NULL,
    "isFokus"    BOOLEAN NOT NULL DEFAULT false,
    "syncedAt"   TIMESTAMP(3),

    CONSTRAINT "CustomerOutlet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerOutlet_customerId_kodePI_key" ON "CustomerOutlet"("customerId", "kodePI");
CREATE INDEX "CustomerOutlet_kodePI_idx" ON "CustomerOutlet"("kodePI");
CREATE INDEX "CustomerOutlet_customerId_idx" ON "CustomerOutlet"("customerId");
CREATE INDEX "CustomerOutlet_kodePI_isFokus_idx" ON "CustomerOutlet"("kodePI", "isFokus");

-- AddForeignKey
ALTER TABLE "CustomerOutlet" ADD CONSTRAINT "CustomerOutlet_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerOutlet" ADD CONSTRAINT "CustomerOutlet_kodePI_fkey"
    FOREIGN KEY ("kodePI") REFERENCES "Outlet"("kodePI") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: make kodeRequest and kodeCust nullable on PoaLineItem
ALTER TABLE "PoaLineItem" ALTER COLUMN "kodeRequest" DROP NOT NULL;
ALTER TABLE "PoaLineItem" ALTER COLUMN "kodeCust" DROP NOT NULL;
