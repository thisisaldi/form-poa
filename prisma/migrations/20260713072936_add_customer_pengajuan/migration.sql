-- CreateTable
CREATE TABLE "CustomerPengajuan" (
    "id" TEXT NOT NULL,
    "namaLengkap" TEXT NOT NULL,
    "namaPanggilan" TEXT NOT NULL,
    "jabatan" TEXT NOT NULL,
    "tipeCustomer" TEXT NOT NULL,
    "tanggalLahir" TIMESTAMP(3),
    "jenisKelamin" TEXT,
    "alamatRumah" TEXT,
    "kota" TEXT,
    "nik" TEXT,
    "email" TEXT,
    "nomorHp1" TEXT NOT NULL,
    "nomorHp2" TEXT,
    "rekening" JSONB NOT NULL DEFAULT '[]',
    "universitasS1" TEXT,
    "spesialisasi" TEXT NOT NULL,
    "universitasSpesialis" TEXT,
    "subSpesialisasi" TEXT,
    "organisasi" JSONB NOT NULL DEFAULT '[]',
    "outletsPengajuan" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedBy" TEXT NOT NULL,
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPengajuan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerPengajuan_submittedBy_idx" ON "CustomerPengajuan"("submittedBy");

-- CreateIndex
CREATE INDEX "CustomerPengajuan_status_idx" ON "CustomerPengajuan"("status");

-- CreateIndex
CREATE INDEX "CustomerPengajuan_spesialisasi_idx" ON "CustomerPengajuan"("spesialisasi");

-- AddForeignKey
ALTER TABLE "CustomerPengajuan" ADD CONSTRAINT "CustomerPengajuan_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;
