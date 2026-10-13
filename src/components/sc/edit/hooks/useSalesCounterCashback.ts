// calculateCashbackDetails moved to src/lib/scCashback.ts so server code
// (form summary, exports) and client hooks share one implementation.
export { calculateCashbackDetails } from "@/lib/scCashback";
export type { CashbackData } from "@/lib/scCashback";
