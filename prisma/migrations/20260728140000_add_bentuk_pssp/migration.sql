-- New "Jenis PSSP" dropdown next to PS/SP (Cash/Barang/Jasa) — see BentukPssp
-- enum doc comment in schema.prisma.
CREATE TYPE "BentukPssp" AS ENUM ('CASH', 'BARANG', 'JASA');

ALTER TABLE "PoaLineItem" ADD COLUMN "bentukPssp" "BentukPssp";
