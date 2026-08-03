-- View-only mode: freezes non-ADMIN writes without a full lockout (see MaintenanceMode doc comment in schema.prisma).
ALTER TABLE "MaintenanceMode" ADD COLUMN "viewOnly" BOOLEAN NOT NULL DEFAULT false;
