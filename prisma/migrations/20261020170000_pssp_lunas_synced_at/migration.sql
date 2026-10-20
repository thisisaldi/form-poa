-- When PsspKontrak.totalLunas was last confirmed from Exodus settlements (docs/pssp-live/); null = Excel number.
ALTER TABLE "PsspKontrak" ADD COLUMN "lunasSyncedAt" TIMESTAMP(3);
