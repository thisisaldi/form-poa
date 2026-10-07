-- Nilai di DB jadi "SALES SUPPORT" (spasi); identifier Prisma/TS tetap SALES_SUPPORT lewat @map.
ALTER TYPE "Role" RENAME VALUE 'SALES_SUPPORT' TO 'SALES SUPPORT';
