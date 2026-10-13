-- Status approval request DPL/DPF dari Exodus (monitoring Approved/Pending di dashboard POA Standarisasi).
ALTER TABLE "PoaStandarisasiDiscountRequest"
    ADD COLUMN "exodusRefId" TEXT,
    ADD COLUMN "exodusStatus" TEXT,
    ADD COLUMN "exodusStatusAt" TIMESTAMP(3);
