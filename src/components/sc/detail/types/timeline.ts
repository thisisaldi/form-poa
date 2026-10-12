import type { PoaStatus, User } from "@prisma/client";

export interface SalesCounterAuditLogItem {
  id: string;
  actorId: string;
  actor: Pick<User, "nip" | "name" | "role" | "jabatan">;
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
  formIds: string[];
}

export interface SalesCounterActivityTimelineProps {
  outlets: Array<{ formId: string; kodePI: string; namaOutlet?: string | null }>;
}
