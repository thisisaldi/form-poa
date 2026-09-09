import type { PoaStatus, User } from "@prisma/client";

export interface SalesCounterAuditLogItem {
  id: string;
  actorId: string;
  actor: User;
  action: string;
  fromStatus?: PoaStatus | string | null;
  toStatus?: PoaStatus | string | null;
  namaOutlet?: string | null;
  kodePI?: string | null;
  snapshot?: any;
  createdAt: Date | string;
}

export interface AvailableOutletItem {
  kodePI: string;
  namaOutlet: string;
  count: number;
}

export interface SalesCounterActivityTimelineProps {
  auditLogs: SalesCounterAuditLogItem[];
  outlets?: Array<{ kodePI: string; namaOutlet?: string | null }>;
}
