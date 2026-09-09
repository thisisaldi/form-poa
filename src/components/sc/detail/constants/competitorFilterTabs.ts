export type CompetitorFilterKey = "semua" | "survey" | "healthyone" | "b2b";

export interface CompetitorFilterTabItem {
  id: CompetitorFilterKey;
  label: string;
  sourceText?: string;
  activeBg: string;
  activeText: string;
  activeBorder: string;
  inactiveText: string;
  inactiveBorder: string;
}

export const COMPETITOR_FILTER_TABS: CompetitorFilterTabItem[] = [
  {
    id: "semua",
    label: "Semua",
    activeBg: "#7c3aed",
    activeText: "#ffffff",
    activeBorder: "#7c3aed",
    inactiveText: "#7c3aed",
    inactiveBorder: "#ddd6fe",
  },
  {
    id: "survey",
    label: "Survey",
    sourceText: "Survey Tim Bisnis",
    activeBg: "#dc2626",
    activeText: "#ffffff",
    activeBorder: "#dc2626",
    inactiveText: "#dc2626",
    inactiveBorder: "#fca5a5",
  },
  {
    id: "healthyone",
    label: "HealthyOne",
    sourceText: "Apotek Online / CDB",
    activeBg: "#026D77",
    activeText: "#ffffff",
    activeBorder: "#026D77",
    inactiveText: "#026D77",
    inactiveBorder: "#80ced4",
  },
  {
    id: "b2b",
    label: "B2B",
    sourceText: "Pharmanet / Toko Online",
    activeBg: "#028CD5",
    activeText: "#ffffff",
    activeBorder: "#028CD5",
    inactiveText: "#028CD5",
    inactiveBorder: "#7dd3fc",
  },
];

export const COMPETITOR_ITEMS_PER_PAGE = 4;
