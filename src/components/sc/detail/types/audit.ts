export interface RevisionInfo {
  action: string;
  notes: string;
  category: string;
  actorLabel: string | null;
  requestEditReasonText: string | null;
}

export interface PendingEditRequestResult {
  hasPendingEditRequest: boolean;
  pendingEditRequestNotes: string;
}
