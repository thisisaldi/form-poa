-- DiskonHistory.avgDiskonPct -> maxDiskonPct: fallback discount now takes the
-- highest single-invoice % Total Diskon per outlet+product instead of a
-- weighted average (2026-07-28 business owner request). Data is repopulated
-- by re-running scripts/importDiskonHistory.ts against the source Excel file
-- after this migration, so the rename alone is enough here.
ALTER TABLE "DiskonHistory" RENAME COLUMN "avgDiskonPct" TO "maxDiskonPct";
