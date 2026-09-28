-- Admin-editable login block (singleton row, id=1). Empty blockedRoles = nobody blocked.
CREATE TABLE "LoginAccessConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "blockedRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedNips" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "message" TEXT,
    "updatedByNip" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginAccessConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "LoginAccessConfig" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);
