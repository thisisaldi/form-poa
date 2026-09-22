import type { ScDraftFormItem } from "../../types";

export interface SalesCounterOutletCardProps {
  draft: ScDraftFormItem;
  checked: boolean;
  onToggle: () => void;
  selectable?: boolean;
  poaId: string;
  userCanEdit?: boolean;
  isOwner?: boolean;
  canApprove?: boolean;
  canFastTrack?: boolean;
  userRole?: string;
  headerFormat?: "default" | "pi-quarter-outlet";
  isKompetitorOpen?: boolean;
  onToggleKompetitor?: () => void;
  onCloseKompetitor?: () => void;
}
