-- Call Activity realisasi is now a window-capped daily average (fractional).
ALTER TABLE "KpiMonthlyEntry" ALTER COLUMN "callActivityRealisasi" SET DATA TYPE DOUBLE PRECISION;
