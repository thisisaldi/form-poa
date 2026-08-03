-- Site-wide maintenance-mode lockout switch (singleton row, id=1).
CREATE TABLE "MaintenanceMode" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "updatedByNip" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceMode_pkey" PRIMARY KEY ("id")
);

INSERT INTO "MaintenanceMode" ("id", "enabled", "updatedAt") VALUES (1, false, CURRENT_TIMESTAMP);
