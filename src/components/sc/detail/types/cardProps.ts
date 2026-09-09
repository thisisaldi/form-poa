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
  isKompetitorOpen?: boolean;
  onToggleKompetitor?: () => void;
  onCloseKompetitor?: () => void;
}
