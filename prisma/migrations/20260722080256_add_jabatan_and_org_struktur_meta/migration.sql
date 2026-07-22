-- AlterTable
ALTER TABLE "User" ADD COLUMN     "jabatan" TEXT;

-- CreateTable
CREATE TABLE "OrgStrukturMeta" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "periode" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgStrukturMeta_pkey" PRIMARY KEY ("id")
);
