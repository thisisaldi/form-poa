export interface SalesCounterApprovePanelProps {
  selectedCount: number;
  actionableCount: number;
  totalCount?: number;
  selectedIds: string[];
  onActionComplete?: () => void;
}
