// Same 5 months the import script (scripts/importTargetHospitalValue.ts)
// populates from "Target Hospital (in Value).xlsx" — kept in sync manually,
// there's no calendar-derived source for which months this target program
// actually covers. Split out of the "use server" actions file since that
// file may only export async functions, not plain constants.
export const TARGET_HOSPITAL_PERIODS = ["202608", "202609", "202610", "202611", "202612"] as const;
