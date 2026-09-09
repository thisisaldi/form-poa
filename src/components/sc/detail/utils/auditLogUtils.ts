import { displayRole } from "@/lib/role";
import type { RevisionInfo, PendingEditRequestResult } from "../types/audit";
export type { RevisionInfo, PendingEditRequestResult };

/**
 * Safely parses audit log snapshot data from string or object.
 */
export function parseSnapshot(raw: any): any {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

/**
 * Extracts pending edit request information from audit logs.
 */
export function extractPendingEditRequest(auditLogs?: any[]): PendingEditRequestResult {
  if (!auditLogs || auditLogs.length === 0) {
    return { hasPendingEditRequest: false, pendingEditRequestNotes: "" };
  }

  const lastLog = auditLogs[auditLogs.length - 1];
  const hasPendingEditRequest = lastLog?.action === "REQUEST_EDIT";

  let pendingEditRequestNotes = "";
  if (hasPendingEditRequest) {
    const snap = parseSnapshot(lastLog?.snapshot);
    if (typeof snap === "string") {
      pendingEditRequestNotes = snap;
    } else if (snap && typeof snap === "object") {
      pendingEditRequestNotes = snap.notes || snap.reason || "";
    }
  }

  return { hasPendingEditRequest, pendingEditRequestNotes };
}

/**
 * Finds the latest revision/rejection/grant-edit log from the audit log trail.
 */
export function extractLastRevisionLog(auditLogs?: any[]): any | null {
  if (!auditLogs || auditLogs.length === 0) return null;
  return (
    [...auditLogs].reverse().find(
      (log) =>
        log.action === "REVISE" ||
        log.action === "REJECT" ||
        log.action === "GRANT_EDIT" ||
        log.toStatus === "REVISI"
    ) || null
  );
}

/**
 * Parses snapshot details and requester reasons for the active revision.
 */
export function extractRevisionInfo(
  auditLogs?: any[],
  lastRevisionLog?: any | null
): RevisionInfo | null {
  if (!lastRevisionLog) return null;

  let snapshot = lastRevisionLog.snapshot;
  if (typeof snapshot === "string") {
    try {
      snapshot = JSON.parse(snapshot);
    } catch {
      snapshot = { notes: snapshot };
    }
  }

  const notes = snapshot?.notes || snapshot?.reason || "";
  const category = snapshot?.category || "";
  const actorLabel = lastRevisionLog.actor
    ? `${lastRevisionLog.actor.name} (${displayRole(lastRevisionLog.actor.role)})`
    : null;

  let requestEditReasonText: string | null = null;
  if (lastRevisionLog.action === "GRANT_EDIT" && auditLogs) {
    const reqLog = [...auditLogs].reverse().find((l) => l.action === "REQUEST_EDIT");
    if (reqLog) {
      let reqSnap = reqLog.snapshot;
      if (typeof reqSnap === "string") {
        try {
          reqSnap = JSON.parse(reqSnap);
        } catch {
          reqSnap = { notes: reqSnap };
        }
      }
      requestEditReasonText = reqSnap?.notes || reqSnap?.reason || null;
    }
  }

  return {
    action: lastRevisionLog.action,
    notes,
    category,
    actorLabel,
    requestEditReasonText,
  };
}
