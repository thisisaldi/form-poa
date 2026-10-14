-- Riwayat aktivitas POA Standarisasi (append-only). Satu tabel baru + backfill dari timestamp yang sudah ada.
CREATE TABLE "PoaStandarisasiActivityLog" (
    "id" TEXT NOT NULL,
    "pengajuanId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "actorNip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoaStandarisasiActivityLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PoaStandarisasiActivityLog_pengajuanId_createdAt_idx" ON "PoaStandarisasiActivityLog"("pengajuanId", "createdAt");
ALTER TABLE "PoaStandarisasiActivityLog" ADD CONSTRAINT "PoaStandarisasiActivityLog_pengajuanId_fkey" FOREIGN KEY ("pengajuanId") REFERENCES "PoaStandarisasi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PoaStandarisasiActivityLog" ADD CONSTRAINT "PoaStandarisasiActivityLog_actorNip_fkey" FOREIGN KEY ("actorNip") REFERENCES "User"("nip") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: hanya kejadian yang timestamp + pelakunya sudah tersimpan. TTD dokter & jadwal KFT
-- tidak punya timestamp historis, jadi tidak di-backfill (tercatat mulai sekarang).
INSERT INTO "PoaStandarisasiActivityLog" ("id", "pengajuanId", "action", "detail", "actorNip", "createdAt")
SELECT gen_random_uuid()::text, p."id", 'DIBUAT', NULL, p."ownerId", p."createdAt" FROM "PoaStandarisasi" p;

INSERT INTO "PoaStandarisasiActivityLog" ("id", "pengajuanId", "action", "detail", "actorNip", "createdAt")
SELECT gen_random_uuid()::text, pr."pengajuanId", 'APPROVAL_ATASAN',
       a."level"::text || ' — ' || CASE a."status"::text WHEN 'DISETUJUI' THEN 'Disetujui' ELSE 'Ditolak' END || ' — ' || string_agg(prod."namaProduk", ', ' ORDER BY prod."namaProduk"),
       a."decidedByNip", date_trunc('second', a."decidedAt")
FROM "PoaStandarisasiProdukApproval" a
JOIN "PoaStandarisasiProduk" pr ON pr."id" = a."produkId"
JOIN "Product" prod ON prod."kodeProduk" = pr."kodeProduk"
JOIN "User" u ON u."nip" = a."decidedByNip"
WHERE a."decidedAt" IS NOT NULL
GROUP BY pr."pengajuanId", a."level", a."status", a."decidedByNip", date_trunc('second', a."decidedAt");

INSERT INTO "PoaStandarisasiActivityLog" ("id", "pengajuanId", "action", "detail", "actorNip", "createdAt")
SELECT gen_random_uuid()::text, p."id", 'SUBMIT_FINALISASI', NULL, p."ownerId", p."submittedAt" FROM "PoaStandarisasi" p WHERE p."submittedAt" IS NOT NULL;

INSERT INTO "PoaStandarisasiActivityLog" ("id", "pengajuanId", "action", "detail", "actorNip", "createdAt")
SELECT gen_random_uuid()::text, p."id", 'SP_NON_SALES_DIAJUKAN', NULL, p."ownerId", p."spNonSalesSubmittedAt" FROM "PoaStandarisasi" p WHERE p."spNonSalesSubmittedAt" IS NOT NULL;

INSERT INTO "PoaStandarisasiActivityLog" ("id", "pengajuanId", "action", "detail", "actorNip", "createdAt")
SELECT gen_random_uuid()::text, p."id", 'MEMO_DIBUAT', p."spNonSalesMemoNomor", p."ownerId", p."spNonSalesMemoGeneratedAt" FROM "PoaStandarisasi" p WHERE p."spNonSalesMemoGeneratedAt" IS NOT NULL;

INSERT INTO "PoaStandarisasiActivityLog" ("id", "pengajuanId", "action", "detail", "actorNip", "createdAt")
SELECT gen_random_uuid()::text, p."id", 'MEMO_TTD', p."spNonSalesMemoNomor", p."spNonSalesSignedByNip", p."spNonSalesSignedAt"
FROM "PoaStandarisasi" p JOIN "User" u ON u."nip" = p."spNonSalesSignedByNip" WHERE p."spNonSalesSignedAt" IS NOT NULL;

INSERT INTO "PoaStandarisasiActivityLog" ("id", "pengajuanId", "action", "detail", "actorNip", "createdAt")
SELECT gen_random_uuid()::text, d."pengajuanId", 'DPL_DPF_DIKIRIM', d."tipe" || ' — ' || d."distributorKode", d."submittedByNip", d."submittedAt" FROM "PoaStandarisasiDiscountRequest" d;

INSERT INTO "PoaStandarisasiActivityLog" ("id", "pengajuanId", "action", "detail", "actorNip", "createdAt")
SELECT gen_random_uuid()::text, pr."pengajuanId", 'GANTI_DOKTER', l."oldNamaSnapshot" || ' → ' || l."newNamaSnapshot" || ' (' || l."reason" || ')', l."actorNip", l."createdAt"
FROM "PoaStandarisasiDokterReassignLog" l JOIN "PoaStandarisasiProduk" pr ON pr."id" = l."produkId";
