-- AlterTable (revert 20260902010000 — outlet_id/customer_id now sourced from
-- our own kodePI/kodeCust, not Exodus's numeric ids; customerCodeExodus dropped)
ALTER TABLE "Outlet" DROP COLUMN "exodusOutletId";
ALTER TABLE "Customer" DROP COLUMN "exodusCustomerId";
ALTER TABLE "Customer" DROP COLUMN "customerCodeExodus";
